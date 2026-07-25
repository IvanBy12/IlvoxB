BEGIN;

DO $$
DECLARE
  linked_deliverables integer;
  expected_column integer;
  expected_constraints integer;
  expected_index integer;
BEGIN
  SELECT count(*) INTO linked_deliverables
  FROM deliverables
  WHERE milestone_id IS NOT NULL;

  SELECT count(*) INTO expected_column
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'deliverables'
    AND column_name = 'milestone_id';

  SELECT count(*) INTO expected_constraints
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = current_schema()
    AND (
      (t.relname = 'deliverables' AND c.conname = 'fk_deliverables_milestone_project')
      OR
      (t.relname = 'project_milestones'
       AND c.conname = 'uq_project_milestones_id_project_organization')
    );

  SELECT count(*) INTO expected_index
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = 'idx_deliverables_milestone';

  IF linked_deliverables <> 0 OR expected_column <> 1
     OR expected_constraints <> 2 OR expected_index <> 1 THEN
    RAISE EXCEPTION
      'Deliverable milestone rollback preflight mismatch: linked=% column=% constraints=% index=%',
      linked_deliverables, expected_column, expected_constraints, expected_index;
  END IF;
END $$;

DROP INDEX idx_deliverables_milestone;

ALTER TABLE deliverables
  DROP CONSTRAINT fk_deliverables_milestone_project,
  DROP COLUMN milestone_id;

ALTER TABLE project_milestones
  DROP CONSTRAINT uq_project_milestones_id_project_organization;

DO $$
DECLARE
  residual_column integer;
  residual_constraints integer;
  residual_index integer;
BEGIN
  SELECT count(*) INTO residual_column
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'deliverables'
    AND column_name = 'milestone_id';

  SELECT count(*) INTO residual_constraints
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = current_schema()
    AND (
      (t.relname = 'deliverables' AND c.conname = 'fk_deliverables_milestone_project')
      OR
      (t.relname = 'project_milestones'
       AND c.conname = 'uq_project_milestones_id_project_organization')
    );

  SELECT count(*) INTO residual_index
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = 'idx_deliverables_milestone';

  IF residual_column <> 0 OR residual_constraints <> 0 OR residual_index <> 0 THEN
    RAISE EXCEPTION
      'Deliverable milestone rollback result mismatch: column=% constraints=% index=%',
      residual_column, residual_constraints, residual_index;
  END IF;
END $$;

COMMIT;
