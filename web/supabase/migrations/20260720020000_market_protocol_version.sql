alter table markets_meta add column if not exists protocol_version integer not null default 2;

alter table markets_meta drop constraint if exists markets_meta_protocol_version_valid;
alter table markets_meta add constraint markets_meta_protocol_version_valid check (
  protocol_version in (2, 3)
);
