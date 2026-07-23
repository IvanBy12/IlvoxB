BEGIN;

DO $$
DECLARE
  constraint_count integer;
  standalone_conversions integer;
BEGIN
  SELECT count(*) INTO constraint_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = current_schema()
    AND t.relname = 'leads'
    AND c.conname = 'chk_leads_conversion'
    AND c.contype = 'c';

  SELECT count(*) INTO standalone_conversions
  FROM leads
  WHERE status = 'converted' AND converted_organization_id IS NULL;

  IF constraint_count <> 1 THEN
    RAISE EXCEPTION 'Lead conversion rollback constraint mismatch: %', constraint_count;
  END IF;
  IF standalone_conversions <> 0 THEN
    RAISE EXCEPTION
      'Cannot rollback lead standalone conversion with % standalone converted rows',
      standalone_conversions;
  END IF;
END $$;

ALTER TABLE leads DROP CONSTRAINT chk_leads_conversion;
ALTER TABLE leads
  ADD CONSTRAINT chk_leads_conversion
  CHECK (
    (status = 'converted' AND converted_organization_id IS NOT NULL AND converted_at IS NOT NULL)
    OR
    (status <> 'converted' AND converted_organization_id IS NULL AND converted_at IS NULL)
  );

COMMIT;
