# Supabase boundaries

Moros uses two separate Supabase boundaries. The public social project stores profiles, market metadata, comments, reactions, watchlists, and public media. The private sync project stores only opaque encrypted activity pages and must use separate server-only credentials.

## Public social project

1. Create a Supabase project at https://supabase.com.
2. Open the SQL editor and run `supabase/schema.sql` from this directory. It creates the social tables, one-time wallet sign-in challenges, row level security policies, and the avatar, market banner, and comment image storage buckets.
3. For an existing project, apply `supabase/migrations/20260720000000_comment_media_auth.sql` before deploying this web version.
4. In Storage, confirm the `avatars`, `market-banners`, and `comment-media` buckets exist as public read buckets.
5. In Project Settings > API, copy the project URL and anon key.
6. Set the following environment variables (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `NEXT_PUBLIC_SITE_URL`.

## Graceful degradation

`lib/supabase/config.ts` exposes `supabaseEnabled()`, which is `false` whenever `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is unset. `lib/supabase/client.ts` exposes `getBrowserClient()`, which returns `null` when `supabaseEnabled()` is `false`. Every social feature built on top of these must null-guard the client and no-op or hide itself when it is `null`. The app must build and trading must keep working with no Supabase project configured at all.

## Privacy boundary

The social layer is public and opt-in, tied only to a connected wallet address, and separate from the trade path. No order openings, amounts, sides, secrets, nullifiers, or proof witnesses are sent to this project.

## Private activity sync project

1. Create a separate Supabase project.
2. Apply `supabase/migrations/20260723000000_opaque_private_activity_sync.sql`.
3. Set `PRIVATE_SYNC_SUPABASE_URL` and `PRIVATE_SYNC_SUPABASE_SERVICE_ROLE_KEY` only in the server deployment.
4. Start the private service with the canonical deployment manifest so the browser receives the active shared vault.

The browser never opens a Supabase session for private activity. A dedicated API route accepts fixed-shape requests signed by an archive key derived in the browser from a deterministic wallet recovery signature. The server writes with the private project's service role.

The private project stores only opaque bucket and page IDs, a derived verification key, schema and generation numbers, fixed-size AES-256-GCM ciphertext, nonces, ciphertext hashes, and server timestamps. Wallet addresses, market IDs, transaction hashes, commitments, nullifiers, sides, amounts, statuses, LP shares, and exact action times are encrypted inside each fixed-size page.

Writes use compare-and-swap generations. Request nonces are single-use and expire. The browser merges a remote snapshot with validated local records and retries a generation conflict. Supabase is a recovery cache, not the source of truth for balances, ownership, market state, claims, or refunds.

The gateway still observes request IP addresses and timing. This design prevents database administrators from reading activity contents, but it does not claim network-level anonymity.
