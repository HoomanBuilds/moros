create table if not exists payment_sync_accounts (
  network text not null,
  vault text not null,
  locator text not null,
  signing_key text not null,
  current_generation bigint not null default 0,
  current_epoch bigint not null default 0,
  head_hash text not null default repeat('0', 64),
  total_pages integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (network, vault, locator),
  constraint payment_sync_network_valid check (network in ('stellar:testnet', 'stellar:pubnet')),
  constraint payment_sync_vault_valid check (vault ~ '^C[A-Z2-7]{55}$'),
  constraint payment_sync_locator_valid check (locator ~ '^[A-Za-z0-9_-]{43}$'),
  constraint payment_sync_signing_key_valid check (signing_key ~ '^[A-Za-z0-9_-]{43}$'),
  constraint payment_sync_generation_valid check (current_generation >= 0),
  constraint payment_sync_epoch_valid check (current_epoch >= 0),
  constraint payment_sync_head_valid check (head_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_sync_total_pages_valid check (total_pages between 0 and 4096)
);

create table if not exists payment_sync_generations (
  network text not null,
  vault text not null,
  locator text not null,
  generation bigint not null,
  epoch bigint not null,
  parent_hash text not null,
  head_hash text,
  page_count integer,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (network, vault, locator, generation),
  foreign key (network, vault, locator)
    references payment_sync_accounts(network, vault, locator)
    on delete cascade,
  constraint payment_sync_generation_number_valid check (generation > 0),
  constraint payment_sync_generation_epoch_valid check (epoch > 0),
  constraint payment_sync_parent_hash_valid check (parent_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_sync_generation_head_valid check (head_hash is null or head_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_sync_page_count_valid check (page_count is null or page_count between 1 and 256),
  constraint payment_sync_commit_complete check (
    (committed_at is null and head_hash is null and page_count is null)
    or (committed_at is not null and head_hash is not null and page_count is not null)
  )
);

create table if not exists payment_sync_pages (
  network text not null,
  vault text not null,
  locator text not null,
  generation bigint not null,
  page_number integer not null,
  epoch bigint not null,
  previous_hash text not null,
  page_hash text not null,
  encoded_page text not null,
  created_at timestamptz not null default now(),
  primary key (network, vault, locator, generation, page_number),
  foreign key (network, vault, locator, generation)
    references payment_sync_generations(network, vault, locator, generation)
    on delete cascade,
  constraint payment_sync_page_number_valid check (page_number between 0 and 255),
  constraint payment_sync_page_epoch_valid check (epoch > 0),
  constraint payment_sync_previous_hash_valid check (previous_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_sync_page_hash_valid check (page_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_sync_encoded_page_valid check (length(encoded_page) = 5628)
);

create table if not exists payment_sync_sessions (
  token_hash text primary key,
  network text not null,
  vault text not null,
  locator text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (network, vault, locator)
    references payment_sync_accounts(network, vault, locator)
    on delete cascade,
  constraint payment_sync_session_hash_valid check (token_hash ~ '^[0-9a-f]{64}$')
);

create or replace function register_payment_sync_account(
  target_network text,
  target_vault text,
  target_locator text,
  target_signing_key text
)
returns table (
  current_generation bigint,
  current_epoch bigint,
  head_hash text,
  total_pages integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_signing_key text;
begin
  insert into public.payment_sync_accounts (network, vault, locator, signing_key)
  values (target_network, target_vault, target_locator, target_signing_key)
  on conflict (network, vault, locator) do nothing;

  select account.signing_key
  into stored_signing_key
  from public.payment_sync_accounts as account
  where account.network = target_network
    and account.vault = target_vault
    and account.locator = target_locator;

  if stored_signing_key is distinct from target_signing_key then
    raise exception 'archive signing key does not match';
  end if;

  return query
  select account.current_generation, account.current_epoch, account.head_hash, account.total_pages
  from public.payment_sync_accounts as account
  where account.network = target_network
    and account.vault = target_vault
    and account.locator = target_locator;
end;
$$;

create or replace function commit_payment_sync_generation(
  target_network text,
  target_vault text,
  target_locator text,
  target_generation bigint,
  target_epoch bigint,
  target_page_count integer,
  target_parent_hash text,
  target_head_hash text
)
returns table (applied boolean, current_generation bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_generation bigint;
  account_epoch bigint;
  account_head text;
  account_pages integer;
  stored_pages integer;
begin
  select account.current_generation, account.current_epoch, account.head_hash, account.total_pages
  into account_generation, account_epoch, account_head, account_pages
  from public.payment_sync_accounts as account
  where account.network = target_network
    and account.vault = target_vault
    and account.locator = target_locator
  for update;

  if not found then
    raise exception 'sync account is unavailable';
  end if;

  if target_generation <= account_generation then
    if exists (
      select 1 from public.payment_sync_generations as generation
      where generation.network = target_network
        and generation.vault = target_vault
        and generation.locator = target_locator
        and generation.generation = target_generation
        and generation.epoch = target_epoch
        and generation.page_count = target_page_count
        and generation.parent_hash = target_parent_hash
        and generation.head_hash = target_head_hash
        and generation.committed_at is not null
    ) then
      return query select false, account_generation;
      return;
    end if;
    raise exception 'stale archive generation';
  end if;

  if target_generation <> account_generation + 1
    or target_epoch < account_epoch
    or target_parent_hash <> account_head then
    raise exception 'stale archive generation';
  end if;

  select count(*)::integer
  into stored_pages
  from public.payment_sync_pages as page
  where page.network = target_network
    and page.vault = target_vault
    and page.locator = target_locator
    and page.generation = target_generation
    and page.epoch = target_epoch;

  if stored_pages <> target_page_count
    or account_pages + target_page_count > 4096
    or not exists (
      select 1 from public.payment_sync_pages as page
      where page.network = target_network
        and page.vault = target_vault
        and page.locator = target_locator
        and page.generation = target_generation
        and page.page_number = 0
        and page.previous_hash = target_parent_hash
    )
    or not exists (
      select 1 from public.payment_sync_pages as page
      where page.network = target_network
        and page.vault = target_vault
        and page.locator = target_locator
        and page.generation = target_generation
        and page.page_number = target_page_count - 1
        and page.page_hash = target_head_hash
    )
    or exists (
      select 1
      from public.payment_sync_pages as page
      left join public.payment_sync_pages as previous
        on previous.network = page.network
        and previous.vault = page.vault
        and previous.locator = page.locator
        and previous.generation = page.generation
        and previous.page_number = page.page_number - 1
      where page.network = target_network
        and page.vault = target_vault
        and page.locator = target_locator
        and page.generation = target_generation
        and page.page_number > 0
        and (previous.page_hash is null or page.previous_hash <> previous.page_hash)
    ) then
    raise exception 'archive generation is incomplete';
  end if;

  update public.payment_sync_generations
  set head_hash = target_head_hash,
      page_count = target_page_count,
      committed_at = now()
  where network = target_network
    and vault = target_vault
    and locator = target_locator
    and generation = target_generation
    and committed_at is null;

  if not found then
    raise exception 'archive generation is unavailable';
  end if;

  update public.payment_sync_accounts
  set current_generation = target_generation,
      current_epoch = target_epoch,
      head_hash = target_head_hash,
      total_pages = total_pages + target_page_count,
      updated_at = now()
  where network = target_network
    and vault = target_vault
    and locator = target_locator;

  return query select true, target_generation;
end;
$$;

create or replace function delete_payment_sync_generations_before(
  target_network text,
  target_vault text,
  target_locator text,
  minimum_generation bigint
)
returns table (removed integer, total_pages integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_generation bigint;
  removed_generations integer;
  removed_pages integer;
  remaining_pages integer;
begin
  select account.current_generation
  into account_generation
  from public.payment_sync_accounts as account
  where account.network = target_network
    and account.vault = target_vault
    and account.locator = target_locator
  for update;

  if not found or minimum_generation < 1 or minimum_generation > account_generation then
    raise exception 'invalid minimum archive generation';
  end if;

  select count(*)::integer, coalesce(sum(generation.page_count), 0)::integer
  into removed_generations, removed_pages
  from public.payment_sync_generations as generation
  where generation.network = target_network
    and generation.vault = target_vault
    and generation.locator = target_locator
    and generation.generation < minimum_generation
    and generation.committed_at is not null;

  delete from public.payment_sync_generations
  where network = target_network
    and vault = target_vault
    and locator = target_locator
    and generation < minimum_generation
    and committed_at is not null;

  update public.payment_sync_accounts as account
  set total_pages = greatest(account.total_pages - removed_pages, 0),
      updated_at = now()
  where account.network = target_network
    and account.vault = target_vault
    and account.locator = target_locator
  returning account.total_pages into remaining_pages;

  return query select removed_generations, remaining_pages;
end;
$$;

create index if not exists payment_sync_pages_read_index
  on payment_sync_pages(network, vault, locator, generation, page_number);

create index if not exists payment_sync_sessions_expiry_index
  on payment_sync_sessions(expires_at);

alter table payment_sync_accounts enable row level security;
alter table payment_sync_generations enable row level security;
alter table payment_sync_pages enable row level security;
alter table payment_sync_sessions enable row level security;

revoke all on payment_sync_accounts from anon, authenticated;
revoke all on payment_sync_generations from anon, authenticated;
revoke all on payment_sync_pages from anon, authenticated;
revoke all on payment_sync_sessions from anon, authenticated;
revoke all on function register_payment_sync_account(text, text, text, text) from public, anon, authenticated;
revoke all on function commit_payment_sync_generation(text, text, text, bigint, bigint, integer, text, text) from public, anon, authenticated;
revoke all on function delete_payment_sync_generations_before(text, text, text, bigint) from public, anon, authenticated;
grant execute on function register_payment_sync_account(text, text, text, text) to service_role;
grant execute on function commit_payment_sync_generation(text, text, text, bigint, bigint, integer, text, text) to service_role;
grant execute on function delete_payment_sync_generations_before(text, text, text, bigint) to service_role;
