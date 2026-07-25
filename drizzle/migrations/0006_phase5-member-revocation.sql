-- Transaction boundary is supplied by the official Drizzle PostgreSQL migrator.
-- Do not execute this file directly outside that migrator.

DO $$
DECLARE
  existing_columns integer;
  existing_constraints integer;
  existing_index integer;
BEGIN
  SELECT count(*) INTO existing_columns
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'project_members'
    AND column_name IN ('status', 'revoked_at', 'revoked_by_user_id');

  SELECT count(*) INTO existing_constraints
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

  SELECT count(*) INTO existing_index
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = 'idx_project_members_active_user';

  IF existing_columns <> 0 OR existing_constraints <> 0 OR existing_index <> 0 THEN
    RAISE EXCEPTION
      'Member revocation preflight mismatch: columns=% constraints=% index=%',
      existing_columns, existing_constraints, existing_index;
  END IF;
END $$;

ALTER TABLE project_members
  ADD COLUMN status varchar(20) NOT NULL DEFAULT 'active',
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN revoked_by_user_id uuid;

ALTER TABLE project_members
  ADD CONSTRAINT project_members_revoked_by_user_id_fkey
    FOREIGN KEY (revoked_by_user_id)
    REFERENCES app_users (id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  ADD CONSTRAINT chk_project_members_status
    CHECK (status IN ('active', 'revoked')),
  ADD CONSTRAINT chk_project_members_revocation
    CHECK (
      (status = 'active' AND revoked_at IS NULL AND revoked_by_user_id IS NULL)
      OR
      (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
    );

CREATE INDEX idx_project_members_active_user
  ON project_members (user_id, project_id)
  WHERE status = 'active';

DO $$
DECLARE
  result_columns integer;
  result_constraints integer;
  validated_constraints integer;
  result_index integer;
  invalid_rows integer;
BEGIN
  SELECT count(*) INTO result_columns
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'project_members'
    AND column_name IN ('status', 'revoked_at', 'revoked_by_user_id');

  SELECT count(*), count(*) FILTER (WHERE c.convalidated)
  INTO result_constraints, validated_constraints
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

  SELECT count(*) INTO result_index
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = 'idx_project_members_active_user'
    AND indexdef ILIKE '%WHERE%status%active%';

  SELECT count(*) INTO invalid_rows
  FROM project_members
  WHERE status <> 'active'
     OR revoked_at IS NOT NULL
     OR revoked_by_user_id IS NOT NULL;

  IF result_columns <> 3 OR result_constraints <> 3
     OR validated_constraints <> 3 OR result_index <> 1 OR invalid_rows <> 0 THEN
    RAISE EXCEPTION
      'Member revocation result mismatch: columns=% constraints=% validated=% index=% invalid=%',
      result_columns, result_constraints, validated_constraints, result_index, invalid_rows;
  END IF;
END $$;
