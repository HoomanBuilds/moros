alter table markets_meta add column if not exists resolver_type text not null default 'price';
alter table markets_meta add column if not exists resolution_rules text;
alter table markets_meta add column if not exists void_rules text;
alter table markets_meta add column if not exists rules_hash text;

alter table markets_meta drop constraint if exists markets_meta_resolver_type_valid;
alter table markets_meta add constraint markets_meta_resolver_type_valid check (
  resolver_type in ('price', 'event')
);

alter table markets_meta drop constraint if exists markets_meta_event_resolution_complete;
alter table markets_meta add constraint markets_meta_event_resolution_complete check (
  resolver_type = 'price'
  or (
    title is not null
    and length(trim(title)) >= 12
    and resolution_source is not null
    and length(trim(resolution_source)) > 0
    and resolution_rules is not null
    and length(trim(resolution_rules)) >= 20
    and void_rules is not null
    and length(trim(void_rules)) >= 20
    and rules_hash ~ '^[0-9a-f]{64}$'
  )
);
