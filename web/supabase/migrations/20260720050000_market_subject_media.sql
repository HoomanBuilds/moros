alter table markets_meta add column if not exists subject text;
alter table markets_meta add column if not exists banner_source_url text;
alter table markets_meta add column if not exists banner_attribution text;
alter table markets_meta add column if not exists banner_license text;
alter table markets_meta add column if not exists banner_license_url text;

alter table markets_meta drop constraint if exists markets_meta_subject_length;
alter table markets_meta add constraint markets_meta_subject_length check (
  subject is null or char_length(subject) between 2 and 120
);

alter table markets_meta drop constraint if exists markets_meta_banner_urls_https;
alter table markets_meta add constraint markets_meta_banner_urls_https check (
  (banner_url is null or banner_url ~ '^https://')
  and (banner_source_url is null or banner_source_url ~ '^https://')
  and (banner_license_url is null or banner_license_url ~ '^https://')
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'market-banners',
  'market-banners',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
