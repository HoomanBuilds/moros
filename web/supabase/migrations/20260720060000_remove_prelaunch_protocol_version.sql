alter table markets_meta drop constraint if exists markets_meta_protocol_version_valid;
alter table markets_meta drop column if exists protocol_version;
