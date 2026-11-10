# Payment recovery schema

`migrations/20260823000000_private_payment_sync.sql` defines the encrypted payment recovery accounts, generations, pages, access controls, and atomic persistence functions consumed by `services/payment-sync-supabase.mjs`.

The migration is preserved unchanged. Repository separation does not execute migrations or change the production database. Existing Supabase credentials remain private service configuration.
