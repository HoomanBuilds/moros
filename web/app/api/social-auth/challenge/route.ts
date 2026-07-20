import { StrKey } from "@stellar/stellar-sdk";
import { createSocialChallenge } from "@/lib/social/challenge";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function socialDomain(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      return new URL(configured).host;
    } catch {
      return configured;
    }
  }
  return new URL(req.url).host;
}

export async function POST(req: Request): Promise<Response> {
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "social features are not configured" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  if (!StrKey.isValidEd25519PublicKey(address)) {
    return Response.json({ error: "invalid Stellar wallet address" }, { status: 400 });
  }

  const challenge = createSocialChallenge(address, socialDomain(req));
  const { error } = await admin.from("social_auth_challenges").insert({
    id: challenge.id,
    wallet: address,
    message: challenge.message,
    expires_at: challenge.expiresAt,
  });
  if (error) return Response.json({ error: "could not create sign-in challenge" }, { status: 500 });

  await admin.from("social_auth_challenges").delete().lt("expires_at", new Date(Date.now() - 86400000).toISOString());

  return Response.json(challenge, { headers: { "Cache-Control": "no-store" } });
}
