# Supabase social layer

This app can optionally use Supabase for a public social layer: profiles, market metadata, comments, reactions, and watchlists. It is entirely optional. With no Supabase project configured, the app builds and trades normally, and every social feature is simply inert.

## Setup

1. Create a Supabase project at https://supabase.com.
2. Open the SQL editor and run `supabase/schema.sql` from this directory. It creates the social tables, one-time wallet sign-in challenges, row level security policies, and the avatar, market banner, and comment image storage buckets.
3. For an existing project, apply `supabase/migrations/20260720000000_comment_media_auth.sql` before deploying this web version.
4. In Storage, confirm the `avatars`, `market-banners`, and `comment-media` buckets exist as public read buckets.
5. In Project Settings > API, copy the project URL and anon key.
6. Set the following environment variables (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `NEXT_PUBLIC_SITE_URL`.

## Graceful degradation

`lib/supabase/config.ts` exposes `supabaseEnabled()`, which is `false` whenever `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is unset. `lib/supabase/client.ts` exposes `getBrowserClient()`, which returns `null` when `supabaseEnabled()` is `false`. Every social feature built on top of these must null-guard the client and no-op or hide itself when it is `null`. The app must build and trading must keep working with no Supabase project configured at all.

## Privacy boundary

The social layer is public and opt-in, tied only to a connected wallet address, and is completely separate from the trade path. No order openings, amounts, sides, secrets, nullifiers, or proof witnesses are sent to Supabase. A user can create, bet, resolve, claim, and refund without touching Supabase, though a market will not appear in the shared off-chain catalog until its public metadata is listed.
