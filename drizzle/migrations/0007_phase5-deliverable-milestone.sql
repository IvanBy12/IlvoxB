-- Transaction boundary is supplied by the official Drizzle PostgreSQL migrator.
-- Do not execute this file directly outside that migrator.

DO $$
DECLARE
  existing_column integer;
  existing_constraints integer;
  existing_index integer;
BEGIN
  SELECT count(*) INTO existing_column
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'deliverables'
    AND column_name = 'milestone_id';

  SELECT count(*) INTO existing_constraints
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

  SELECT count(*) INTO existing_index
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = 'idx_deliverables_milestone';

  IF existing_column <> 0 OR existing_constraints <> 0 OR existing_index <> 0 THEN
    RAISE EXCEPTION
      'Deliverable milestone preflight mismatch: column=% constraints=% index=%',
      existing_column, existing_constraints, existing_index;
  END IF;
END $$;

ALTER TABLE project_milestones
  ADD CONSTRAINT uq_project_milestones_id_project_organization
  UNIQUE (id, project_id, organization_id);

ALTER TABLE deliverables
  ADD COLUMN milestone_id uuid,
  ADD CONSTRAINT fk_deliverables_milestone_project
    FOREIGN KEY (milestone_id, project_id, organization_id)
    REFERENCES project_milestones (id, project_id, organization_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION;

CREATE INDEX idx_deliverables_milestone
  ON deliverables (milestone_id);

DO $$
DECLARE
  result_column integer;
  result_constraints integer;
  validated_constraints integer;
  result_index integer;
  invalid_links integer;
BEGIN
  SELECT count(*) INTO result_column
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'deliverables'
    AND column_name = 'milestone_id'
    AND is_nullable = 'YES';

  SELECT count(*), count(*) FILTER (WHERE c.convalidated)
  INTO result_constraints, validated_constraints
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

  SELECT count(*) INTO result_index
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = 'idx_deliverables_milestone';

  SELECT count(*) INTO invalid_links
  FROM deliverables d
  LEFT JOIN project_milestones m
    ON m.id = d.milestone_id
   AND m.project_id = d.project_id
   AND m.organization_id = d.organization_id
  WHERE d.milestone_id IS NOT NULL AND m.id IS NULL;

  IF result_column <> 1 OR result_constraints <> 2
     OR validated_constraints <> 2 OR result_index <> 1 OR invalid_links <> 0 THEN
    RAISE EXCEPTION
      'Deliverable milestone result mismatch: column=% constraints=% validated=% index=% invalid=%',
      result_column, result_constraints, validated_constraints, result_index, invalid_links;
  END IF;
END $$;
