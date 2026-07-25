BEGIN;

DO $$
DECLARE
  revoked_rows integer;
  expected_columns integer;
  expected_constraints integer;
  expected_index integer;
BEGIN
  SELECT count(*) INTO revoked_rows
  FROM project_members
  WHERE status <> 'active'
     OR revoked_at IS NOT NULL
     OR revoked_by_user_id IS NOT NULL;

  SELECT count(*) INTO expected_columns
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'project_members'
    AND column_name IN ('status', 'revoked_at', 'revoked_by_user_id');

  SELECT count(*) INTO expected_constraints
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = current_schema()
    AND t.relname = 'project_members'
    AND c.conname IN (
      'project_members_revoked_by_user_id_fkey',
      'chk_project_members_status',
      'chk_project_members_revocation'
    );

  SELECT count(*) INTO expected_index
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = 'idx_project_members_active_user';

  IF revoked_rows <> 0 OR expected_columns <> 3
     OR expected_constraints <> 3 OR expected_index <> 1 THEN
    RAISE EXCEPTION
      'Member revocation rollback preflight mismatch: revoked=% columns=% constraints=% index=%',
      revoked_rows, expected_columns, expected_constraints, expected_index;
  END IF;
END $$;

DROP INDEX idx_project_members_active_user;

ALTER TABLE project_members
  DROP CONSTRAINT chk_project_members_revocation,
  DROP CONSTRAINT chk_project_members_status,
  DROP CONSTRAINT project_members_revoked_by_user_id_fkey,
  DROP COLUMN revoked_by_user_id,
  DROP COLUMN revoked_at,
  DROP COLUMN status;

DO $$
DECLARE
  residual_columns integer;
  residual_constraints integer;
  residual_index integer;
BEGIN
  SELECT count(*) INTO residual_columns
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'project_members'
    AND column_name IN ('status', 'revoked_at', 'revoked_by_user_id');

  SELECT count(*) INTO residual_constraints
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = current_schema()
    AND t.relname = 'project_members'
    AND c.conname IN (
      'project_members_revoked_by_user_id_fkey',
      'chk_project_members_status',
      'chk_project_members_revocation'
    );

  SELECT count(*) INTO residual_index
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = 'idx_project_members_active_user';

  IF residual_columns <> 0 OR residual_constraints <> 0 OR residual_index <> 0 THEN
    RAISE EXCEPTION
      'Member revocation rollback result mismatch: columns=% constraints=% index=%',
      residual_columns, residual_constraints, residual_index;
  END IF;
END $$;

COMMIT;
