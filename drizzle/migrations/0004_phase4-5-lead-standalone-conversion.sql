BEGIN;

DO $$
DECLARE
  constraint_count integer;
  invalid_rows integer;
BEGIN
  SELECT count(*) INTO constraint_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = current_schema()
    AND t.relname = 'leads'
    AND c.conname = 'chk_leads_conversion'
    AND c.contype = 'c';

  SELECT count(*) INTO invalid_rows
  FROM leads
  WHERE (status = 'converted' AND converted_at IS NULL)
     OR (status <> 'converted' AND
         (converted_at IS NOT NULL OR converted_organization_id IS NOT NULL));

  IF constraint_count <> 1 OR invalid_rows <> 0 THEN
    RAISE EXCEPTION
      'Lead conversion preflight mismatch: constraint=% invalid_rows=%',
      constraint_count, invalid_rows;
  END IF;
END $$;

ALTER TABLE leads DROP CONSTRAINT chk_leads_conversion;
ALTER TABLE leads
  ADD CONSTRAINT chk_leads_conversion
  CHECK (
    (status = 'converted' AND converted_at IS NOT NULL)
    OR
    (status <> 'converted' AND converted_at IS NULL AND converted_organization_id IS NULL)
  );

DO $$
DECLARE
  constraint_count integer;
  validated_count integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE c.convalidated)
  INTO constraint_count, validated_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = current_schema()
    AND t.relname = 'leads'
    AND c.conname = 'chk_leads_conversion'
    AND c.contype = 'c';

  IF constraint_count <> 1 OR validated_count <> 1 THEN
    RAISE EXCEPTION
      'Lead conversion result mismatch: constraint=% validated=%',
      constraint_count, validated_count;
  END IF;
END $$;

COMMIT;
