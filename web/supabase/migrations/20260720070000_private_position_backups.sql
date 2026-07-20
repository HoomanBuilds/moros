create table if not exists private_positions (
  wallet text not null,
  commitment text not null,
  market_id text not null,
  pool_id text not null,
  tx_hash text not null,
  placed_at timestamptz not null,
  ciphertext text not null,
  encryption_iv text not null,
  updated_at timestamptz not null default now(),
  primary key (wallet, commitment),
  constraint private_positions_wallet_valid check (wallet ~ '^G[A-Z2-7]{55}$'),
  constraint private_positions_market_valid check (market_id ~ '^C[A-Z2-7]{55}$'),
  constraint private_positions_pool_valid check (pool_id ~ '^C[A-Z2-7]{55}$'),
  constraint private_positions_tx_valid check (tx_hash ~ '^[0-9a-fA-F]{64}$'),
  constraint private_positions_ciphertext_size check (length(ciphertext) between 16 and 16384),
  constraint private_positions_iv_size check (length(encryption_iv) between 12 and 64)
);

alter table private_positions enable row level security;

create policy "private_positions_select_owner" on private_positions for select using (
  (auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet
);
create policy "private_positions_insert_owner" on private_positions for insert with check (
  (auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet
);
create policy "private_positions_update_owner" on private_positions for update using (
  (auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet
) with check (
  (auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet
);
create policy "private_positions_delete_owner" on private_positions for delete using (
  (auth.jwt() -> 'app_metadata' ->> 'wallet') = wallet
);
