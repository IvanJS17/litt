# Recovery evidence (historical)

> **Historical evidence (since the upstream sync of 2026-10-23).**
> [`phase3-verification.json`](phase3-verification.json) is the Phase 3
> verification receipt of the August–September 2026 recovery, described in
> [`../PHASE3_RECOVERY_DECISION.md`](../PHASE3_RECOVERY_DECISION.md). That
> recovery used the `*_recovery_*` migration series in a hand-maintained
> order; slice S1 of [`../UPSTREAM_SYNC_PLAN.md`](../UPSTREAM_SYNC_PLAN.md)
> replaced it with upstream's migration runner (`backend/scripts/migrate.sh`
> and the `public.schema_migrations` ledger). The JSON is kept byte for byte
> as a record; it does not describe the current tree.
