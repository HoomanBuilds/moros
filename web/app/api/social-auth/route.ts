import { StrKey } from "@stellar/stellar-sdk";
import { verifyWalletSignature } from "@/lib/social/verify";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function walletEmail(address: string): string {
  return `${address.toLowerCase()}@wallet.local`;
}

export async function POST(req: Request): Promise<Response> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "supabase not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.address !== "string" ||
    typeof body.signatureBase64 !== "string" ||
    typeof body.challengeId !== "string"
  ) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const { address, signatureBase64, challengeId } = body as {
    address: string;
    signatureBase64: string;
    challengeId: string;
  };

  if (!StrKey.isValidEd25519PublicKey(address) || signatureBase64.length > 512) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  const { data: challenge, error: challengeError } = await admin
    .from("social_auth_challenges")
    .select("message, expires_at, used_at")
    .eq("id", challengeId)
    .eq("wallet", address)
    .maybeSingle();
  if (challengeError || !challenge || challenge.used_at || Date.parse(challenge.expires_at) < Date.now()) {
    return Response.json({ error: "challenge expired or already used" }, { status: 401 });
  }

  if (!verifyWalletSignature(address, challenge.message, signatureBase64)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const { data: consumed, error: consumeError } = await admin.rpc("consume_social_auth_challenge", {
    p_id: challengeId,
    p_wallet: address,
  });
  if (consumeError || !Array.isArray(consumed) || consumed.length !== 1) {
    return Response.json({ error: "challenge expired or already used" }, { status: 401 });
  }

  const email = walletEmail(address);

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { wallet: address },
  });
  if (createError && !/already registered|already exists/i.test(createError.message)) {
    return Response.json({ error: createError.message }, { status: 500 });
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !linkData) {
    return Response.json({ error: linkError?.message ?? "link generation failed" }, { status: 500 });
  }

  const { error: metadataError } = await admin.auth.admin.updateUserById(linkData.user.id, {
    app_metadata: { wallet: address },
  });
  if (metadataError) {
    return Response.json({ error: metadataError.message }, { status: 500 });
  }

  const { data: verifyData, error: verifyError } = await admin.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email",
  });
  if (verifyError || !verifyData.session) {
    return Response.json({ error: verifyError?.message ?? "session mint failed" }, { status: 500 });
  }

  return Response.json({
    access_token: verifyData.session.access_token,
    refresh_token: verifyData.session.refresh_token,
  });
}
