import { createClient } from "@supabase/supabase-js";
import { verifyWalletSignature } from "@/lib/social/verify";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const MESSAGE_PREFIX = "Sign in to Moros social - ";
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;

function walletEmail(address: string): string {
  return `${address.toLowerCase()}@wallet.local`;
}

export async function POST(req: Request): Promise<Response> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "supabase not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.address !== "string" ||
    typeof body.signatureBase64 !== "string" ||
    typeof body.message !== "string"
  ) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const { address, signatureBase64, message } = body as {
    address: string;
    signatureBase64: string;
    message: string;
  };

  if (!message.startsWith(MESSAGE_PREFIX)) {
    return Response.json({ error: "invalid message" }, { status: 400 });
  }
  const timestamp = Date.parse(message.slice(MESSAGE_PREFIX.length));
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MAX_MESSAGE_AGE_MS) {
    return Response.json({ error: "stale message" }, { status: 401 });
  }

  if (!verifyWalletSignature(address, message, signatureBase64)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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
