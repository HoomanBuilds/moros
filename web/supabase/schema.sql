create table if not exists profiles (
  wallet text primary key,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists markets_meta (
  market_id text primary key,
  pool_id text,
  asset text,
  title text,
  description text,
  category text,
  banner_url text,
  resolution_source text,
  resolution_backup_sources text[] not null default '{}',
  creator text,
  collateral_code text,
  collateral_issuer text,
  collateral_sac text,
  collateral_decimals integer,
  created_at timestamptz default now()
);

create table if not exists comments (
  id uuid default gen_random_uuid() primary key,
  market_id text not null,
  wallet text not null,
  body text not null,
  parent_id uuid,
  image_url text,
  image_path text,
  image_width integer,
  image_height integer,
  image_alt text,
  created_at timestamptz default now(),
  constraint comments_have_content check (length(trim(body)) > 0 or image_path is not null)
);

create table if not exists social_auth_challenges (
  id uuid primary key,
  wallet text not null,
  message text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function consume_social_auth_challenge(p_id uuid, p_wallet text)
returns table(message text)
language sql
security definer
set search_path = public
as $$
  update social_auth_challenges
  set used_at = now()
  where id = p_id
    and wallet = p_wallet
    and used_at is null
    and expires_at >= now()
  returning social_auth_challenges.message;
$$;

revoke all on function consume_social_auth_challenge(uuid, text) from public, anon, authenticated;
grant execute on function consume_social_auth_challenge(uuid, text) to service_role;

create table if not exists reactions (
  id uuid default gen_random_uuid() primary key,
  subject_type text,
  subject_id text,
  wallet text,
  kind text,
  created_at timestamptz default now(),
  unique (subject_type, subject_id, wallet, kind)
);

create table if not exists watchlist (
  wallet text,
  market_id text,
  created_at timestamptz default now(),
  primary key (wallet, market_id)
);

alter table profiles enable row level security;
alter table markets_meta enable row level security;
alter table comments enable row level security;
alter table social_auth_challenges enable row level security;
alter table reactions enable row level security;
alter table watchlist enable row level security;

create policy "profiles_select_public" on profiles for select using (true);
create policy "profiles_insert_owner" on profiles for insert with check ((auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet);
create policy "profiles_update_owner" on profiles for update using ((auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet);
create policy "profiles_delete_owner" on profiles for delete using ((auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet);

create policy "markets_meta_select_public" on markets_meta for select using (true);
create policy "markets_meta_insert_owner" on markets_meta for insert with check ((auth.jwt() -> 'app_metadata' ->> 'wallet') = creator);
create policy "markets_meta_update_owner" on markets_meta for update using ((auth.jwt() -> 'app_metadata' ->> 'wallet') = creator);
create policy "markets_meta_delete_owner" on markets_meta for delete using ((auth.jwt() -> 'app_metadata' ->> 'wallet') = creator);

create policy "comments_select_public" on comments for select using (true);
create policy "comments_insert_owner" on comments for insert with check (
  (auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet
  and (image_path is null or split_part(image_path, '/', 1) = wallet)
);
create policy "comments_update_owner" on comments for update using (
  (auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet
) with check (
  (auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet
  and (image_path is null or split_part(image_path, '/', 1) = wallet)
);
create policy "comments_delete_owner" on comments for delete using ((auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet);

create policy "reactions_select_public" on reactions for select using (true);
create policy "reactions_insert_owner" on reactions for insert with check ((auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet);
create policy "reactions_update_owner" on reactions for update using ((auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet);
create policy "reactions_delete_owner" on reactions for delete using ((auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet);

create policy "watchlist_select_public" on watchlist for select using (true);
create policy "watchlist_insert_owner" on watchlist for insert with check ((auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet);
create policy "watchlist_update_owner" on watchlist for update using ((auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet);
create policy "watchlist_delete_owner" on watchlist for delete using ((auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet);

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('market-banners', 'market-banners', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comment-media',
  'comment-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "avatars_select_public" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars_insert_authenticated" on storage.objects for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet'));
create policy "avatars_update_authenticated" on storage.objects for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet'));
create policy "avatars_delete_authenticated" on storage.objects for delete using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet'));

create policy "market_banners_select_public" on storage.objects for select using (bucket_id = 'market-banners');
create policy "market_banners_insert_authenticated" on storage.objects for insert with check (bucket_id = 'market-banners' and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet'));
create policy "market_banners_update_authenticated" on storage.objects for update using (bucket_id = 'market-banners' and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet'));
create policy "market_banners_delete_authenticated" on storage.objects for delete using (bucket_id = 'market-banners' and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet'));

create policy "comment_media_select_public" on storage.objects for select using (bucket_id = 'comment-media');
create policy "comment_media_insert_owner" on storage.objects for insert with check (bucket_id = 'comment-media' and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet'));
create policy "comment_media_update_owner" on storage.objects for update using (bucket_id = 'comment-media' and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet')) with check (bucket_id = 'comment-media' and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet'));
create policy "comment_media_delete_owner" on storage.objects for delete using (bucket_id = 'comment-media' and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet'));
