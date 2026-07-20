alter table markets_meta add column if not exists collateral_code text;
alter table markets_meta add column if not exists collateral_issuer text;
alter table markets_meta add column if not exists collateral_sac text;
alter table markets_meta add column if not exists collateral_decimals integer;

alter table markets_meta drop constraint if exists markets_meta_collateral_complete;
alter table markets_meta add constraint markets_meta_collateral_complete check (
  (collateral_code is null and collateral_sac is null and collateral_decimals is null)
  or
  (collateral_code is not null and collateral_sac is not null and collateral_decimals between 0 and 18)
);
