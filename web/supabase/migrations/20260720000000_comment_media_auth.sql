create table if not exists social_auth_challenges (
  id uuid primary key,
  wallet text not null,
  message text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table social_auth_challenges enable row level security;

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

alter table comments add column if not exists image_url text;
alter table comments add column if not exists image_path text;
alter table comments add column if not exists image_width integer;
alter table comments add column if not exists image_height integer;
alter table comments add column if not exists image_alt text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comments_have_content'
  ) then
    alter table comments add constraint comments_have_content
      check (length(trim(body)) > 0 or image_path is not null);
  end if;
end $$;

drop policy if exists "comments_insert_owner" on comments;
drop policy if exists "comments_update_owner" on comments;
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

create policy "comment_media_select_public" on storage.objects for select
using (bucket_id = 'comment-media');
create policy "comment_media_insert_owner" on storage.objects for insert with check (
  bucket_id = 'comment-media'
  and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet')
);
create policy "comment_media_update_owner" on storage.objects for update using (
  bucket_id = 'comment-media'
  and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet')
) with check (
  bucket_id = 'comment-media'
  and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet')
);
create policy "comment_media_delete_owner" on storage.objects for delete using (
  bucket_id = 'comment-media'
  and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'wallet')
);
