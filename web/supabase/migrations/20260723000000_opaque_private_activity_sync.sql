create table if not exists private_sync_buckets (
  bucket_id text primary key,
  verification_key text not null,
  schema_version integer not null,
  current_generation bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_sync_bucket_id_valid check (bucket_id ~ '^[A-Za-z0-9_-]{43}$'),
  constraint private_sync_verification_key_valid check (verification_key ~ '^G[A-Z2-7]{55}$'),
  constraint private_sync_schema_valid check (schema_version = 1),
  constraint private_sync_generation_valid check (current_generation >= 0)
);

create table if not exists private_sync_pages (
  bucket_id text not null references private_sync_buckets(bucket_id) on delete cascade,
  page_id text not null,
  generation bigint not null,
  schema_version integer not null,
  cipher_suite text not null default 'AES-256-GCM',
  ciphertext text not null,
  nonce text not null,
  ciphertext_hash text not null,
  updated_at timestamptz not null default now(),
  primary key (bucket_id, page_id),
  constraint private_sync_page_id_valid check (page_id ~ '^[A-Za-z0-9_-]{43}$'),
  constraint private_sync_page_generation_valid check (generation > 0),
  constraint private_sync_page_schema_valid check (schema_version = 1),
  constraint private_sync_cipher_valid check (cipher_suite = 'AES-256-GCM'),
  constraint private_sync_ciphertext_size check (length(ciphertext) = 87404),
  constraint private_sync_nonce_size check (length(nonce) = 16),
  constraint private_sync_ciphertext_hash_valid check (ciphertext_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists private_sync_nonces (
  bucket_id text not null references private_sync_buckets(bucket_id) on delete cascade,
  nonce text not null,
  expires_at timestamptz not null,
  primary key (bucket_id, nonce),
  constraint private_sync_request_nonce_valid check (nonce ~ '^[A-Za-z0-9_-]{32}$')
);

alter table private_sync_buckets enable row level security;
alter table private_sync_pages enable row level security;
alter table private_sync_nonces enable row level security;

revoke all on private_sync_buckets from anon, authenticated;
revoke all on private_sync_pages from anon, authenticated;
revoke all on private_sync_nonces from anon, authenticated;

create or replace function consume_private_sync_nonce(
  target_bucket text,
  target_nonce text,
  target_expiry timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.private_sync_nonces where expires_at < now();
  insert into public.private_sync_nonces (bucket_id, nonce, expires_at)
  values (target_bucket, target_nonce, target_expiry);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;

create or replace function write_private_sync_pages(
  target_bucket text,
  expected_generation bigint,
  replacement_pages jsonb
)
returns table (applied boolean, current_generation bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_generation bigint;
  next_generation bigint;
begin
  select bucket.current_generation
  into stored_generation
  from public.private_sync_buckets as bucket
  where bucket.bucket_id = target_bucket
  for update;

  if not found then
    return query select false, 0::bigint;
    return;
  end if;

  if stored_generation <> expected_generation then
    return query select false, stored_generation;
    return;
  end if;

  if jsonb_typeof(replacement_pages) <> 'array'
    or jsonb_array_length(replacement_pages) < 1
    or jsonb_array_length(replacement_pages) > 32 then
    raise exception 'invalid private sync page set';
  end if;

  next_generation := stored_generation + 1;
  delete from public.private_sync_pages where bucket_id = target_bucket;

  insert into public.private_sync_pages (
    bucket_id,
    page_id,
    generation,
    schema_version,
    cipher_suite,
    ciphertext,
    nonce,
    ciphertext_hash
  )
  select
    target_bucket,
    page.value ->> 'page_id',
    next_generation,
    1,
    'AES-256-GCM',
    page.value ->> 'ciphertext',
    page.value ->> 'nonce',
    page.value ->> 'ciphertext_hash'
  from jsonb_array_elements(replacement_pages) as page(value);

  update public.private_sync_buckets
  set current_generation = next_generation, updated_at = now()
  where bucket_id = target_bucket;

  return query select true, next_generation;
end;
$$;

revoke all on function consume_private_sync_nonce(text, text, timestamptz) from public, anon, authenticated;
revoke all on function write_private_sync_pages(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function consume_private_sync_nonce(text, text, timestamptz) to service_role;
grant execute on function write_private_sync_pages(text, bigint, jsonb) to service_role;
