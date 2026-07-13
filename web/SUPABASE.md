# Supabase social layer

This app can optionally use Supabase for a public social layer: profiles, market metadata, comments, reactions, and watchlists. It is entirely optional. With no Supabase project configured, the app builds and trades normally, and every social feature is simply inert.

## Setup

1. Create a Supabase project at https://supabase.com.
2. Open the SQL editor and run `supabase/schema.sql` from this directory. It creates the `profiles`, `markets_meta`, `comments`, `reactions`, and `watchlist` tables, enables row level security on each, and adds the public read + owner-write policies and storage buckets.
3. In Storage, confirm the `avatars` and `market-banners` buckets exist as public read buckets (created by the schema script above).
4. In Project Settings > API, copy the project URL and anon key.
5. Set the following environment variables (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` for any server-side admin usage.

## Graceful degradation

`lib/supabase/config.ts` exposes `supabaseEnabled()`, which is `false` whenever `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is unset. `lib/supabase/client.ts` exposes `getBrowserClient()`, which returns `null` when `supabaseEnabled()` is `false`. Every social feature built on top of these must null-guard the client and no-op or hide itself when it is `null`. The app must build and trading must keep working with no Supabase project configured at all.

## Privacy boundary

The social layer is public and opt-in, tied only to a connected wallet address, and is completely separate from the private trade path. No order openings, amounts, sides, or any other private trade data are ever sent to Supabase. A user can deposit, bet, and redeem privately end to end without ever touching Supabase or opting into the social layer.
