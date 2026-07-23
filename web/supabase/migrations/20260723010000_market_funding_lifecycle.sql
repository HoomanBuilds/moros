alter table markets_meta add column if not exists proposal_id text;
alter table markets_meta add column if not exists factory_id text;
alter table markets_meta add column if not exists liquidity_vault_id text;
alter table markets_meta add column if not exists market_state text not null default 'active';
alter table markets_meta add column if not exists liquidity_target numeric;
alter table markets_meta add column if not exists funding_deadline timestamptz;
alter table markets_meta add column if not exists activation_cutoff timestamptz;
alter table markets_meta add column if not exists settlement_time timestamptz;

create unique index if not exists markets_meta_proposal_id_unique
  on markets_meta (proposal_id)
  where proposal_id is not null;

alter table markets_meta drop constraint if exists markets_meta_market_state_valid;
alter table markets_meta add constraint markets_meta_market_state_valid check (
  market_state in ('funding', 'ready', 'active', 'cancelled', 'settled')
);

alter table markets_meta drop constraint if exists markets_meta_funding_fields_complete;
alter table markets_meta add constraint markets_meta_funding_fields_complete check (
  market_state in ('active', 'settled')
  or (
    proposal_id ~ '^[0-9a-f]{64}$'
    and factory_id ~ '^C[A-Z2-7]{55}$'
    and liquidity_vault_id ~ '^C[A-Z2-7]{55}$'
    and liquidity_target > 0
    and funding_deadline is not null
    and activation_cutoff is not null
    and settlement_time is not null
    and funding_deadline <= activation_cutoff
    and activation_cutoff < settlement_time
  )
);
