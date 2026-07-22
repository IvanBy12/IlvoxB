BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM files
    WHERE num_nonnulls(project_id, ticket_id, ticket_comment_id, task_id, deliverable_id) = 0
  ) THEN
    RAISE EXCEPTION 'Cannot rollback file audience while direct files exist';
  END IF;
END $$;
DROP INDEX IF EXISTS idx_files_organization_audience_active;
ALTER TABLE files DROP CONSTRAINT IF EXISTS chk_files_audience;
ALTER TABLE files DROP CONSTRAINT chk_files_single_parent;
ALTER TABLE files ADD CONSTRAINT chk_files_single_parent
  CHECK (num_nonnulls(project_id, ticket_id, ticket_comment_id, task_id, deliverable_id) = 1);
ALTER TABLE files DROP COLUMN audience;
COMMIT;
