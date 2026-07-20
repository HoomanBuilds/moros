alter table markets_meta add column if not exists resolution_backup_sources text[] not null default '{}';

alter table markets_meta drop constraint if exists markets_meta_backup_sources_limit;
alter table markets_meta add constraint markets_meta_backup_sources_limit check (
  cardinality(resolution_backup_sources) <= 3
);
