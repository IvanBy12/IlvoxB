-- Safety guard only.
--
-- The authoritative baseline is ../baseline/0000_ilvox_complete_reconstructed.sql.
-- It must be applied explicitly to a verified empty database with psql. On an existing
-- database, prove catalog and seed parity and then record the baseline timestamp using
-- the reviewed procedure in docs/database-parity.md.
--
-- This deliberate failure prevents `drizzle-kit migrate` from recreating an unmarked
-- schema or silently treating Drizzle's generated DDL as the source of truth.
DO $ilvox_baseline_guard$
BEGIN
  RAISE EXCEPTION
    'ILVOX baseline is not marked. Follow docs/database-parity.md; never auto-apply this migration.';
END
$ilvox_baseline_guard$;
