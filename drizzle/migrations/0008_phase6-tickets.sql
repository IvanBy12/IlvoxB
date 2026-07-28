-- Fase 6: tickets standalone, integridad de comentarios y RBAC mínimo.
DO $$
DECLARE
  orphan_projects integer;
  mismatched_projects integer;
  orphan_comments integer;
  mismatched_comments integer;
  permission_count integer;
  association_count integer;
BEGIN
  SELECT count(*) INTO orphan_projects
  FROM tickets t LEFT JOIN projects p ON p.id = t.project_id
  WHERE t.project_id IS NOT NULL AND p.id IS NULL;
  SELECT count(*) INTO mismatched_projects
  FROM tickets t JOIN projects p ON p.id = t.project_id
  WHERE t.organization_id IS DISTINCT FROM p.organization_id;
  SELECT count(*) INTO orphan_comments
  FROM ticket_comments c LEFT JOIN tickets t ON t.id = c.ticket_id
  WHERE t.id IS NULL;
  SELECT count(*) INTO mismatched_comments
  FROM ticket_comments c JOIN tickets t ON t.id = c.ticket_id
  WHERE c.organization_id IS DISTINCT FROM t.organization_id;
  SELECT count(*) INTO permission_count FROM permissions;
  SELECT count(*) INTO association_count
  FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d;
  IF orphan_projects <> 0 OR mismatched_projects <> 0
     OR orphan_comments <> 0 OR mismatched_comments <> 0 THEN
    RAISE EXCEPTION
      'Phase 6 ticket preflight failed: orphan_projects=% mismatched_projects=% orphan_comments=% mismatched_comments=%',
      orphan_projects, mismatched_projects, orphan_comments, mismatched_comments;
  END IF;
  IF permission_count <> 37 OR association_count <> 159 THEN
    RAISE EXCEPTION
      'Phase 6 RBAC preflight failed: expected permissions=37 associations=159, got %/%',
      permission_count, association_count;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "ticket_comments" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "ticket_comments"
  ADD CONSTRAINT "fk_ticket_comments_ticket_id"
  FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "tickets"
  ADD CONSTRAINT "fk_tickets_project_id"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "tickets"
  ADD CONSTRAINT "chk_tickets_project_requires_organization"
  CHECK ("project_id" IS NULL OR "organization_id" IS NOT NULL);--> statement-breakpoint

CREATE OR REPLACE FUNCTION phase6_derive_ticket_comment_organization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE parent_organization_id uuid;
BEGIN
  SELECT organization_id INTO parent_organization_id
  FROM tickets
  WHERE id = NEW.ticket_id;
  IF NOT FOUND THEN
    RAISE foreign_key_violation
      USING CONSTRAINT = 'fk_ticket_comments_ticket_id',
            MESSAGE = 'ticket comment parent ticket does not exist';
  END IF;
  NEW.organization_id := parent_organization_id;
  RETURN NEW;
END $$;--> statement-breakpoint

CREATE TRIGGER trg_ticket_comments_derive_organization
BEFORE INSERT OR UPDATE OF ticket_id, organization_id
ON ticket_comments
FOR EACH ROW
EXECUTE FUNCTION phase6_derive_ticket_comment_organization();--> statement-breakpoint

CREATE INDEX "idx_tickets_updated_at"
  ON "tickets" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_tickets_standalone_requester_created"
  ON "tickets" USING btree ("requester_user_id", "created_at" DESC NULLS LAST)
  WHERE "organization_id" IS NULL;--> statement-breakpoint

INSERT INTO permissions (code, module, name, description)
VALUES
  ('tickets.update', 'tickets', 'Editar tickets', 'Editar datos generales de tickets autorizados sin cambiar contexto ni estado.'),
  ('tickets.change_priority', 'tickets', 'Cambiar prioridad de tickets', 'Cambiar la prioridad operativa de tickets autorizados.');--> statement-breakpoint

WITH grants (role_scope, role_code, permission_code) AS (
  VALUES
    ('global', 'super_admin', 'tickets.update'),
    ('global', 'admin', 'tickets.update'),
    ('global', 'support_agent', 'tickets.update'),
    ('global', 'super_admin', 'tickets.change_priority'),
    ('global', 'admin', 'tickets.change_priority'),
    ('global', 'support_agent', 'tickets.change_priority')
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM grants g
JOIN roles r ON r.scope = g.role_scope AND r.code = g.role_code
JOIN permissions p ON p.code = g.permission_code;--> statement-breakpoint

DO $$
DECLARE
  permission_count integer;
  association_count integer;
  bad_grants integer;
  missing_objects integer;
BEGIN
  SELECT count(*) INTO permission_count FROM permissions;
  SELECT count(*) INTO association_count
  FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d;
  SELECT count(*) INTO bad_grants
  FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
  WHERE p.code IN ('tickets.update', 'tickets.change_priority')
    AND NOT (r.scope = 'global' AND r.code IN ('super_admin', 'admin', 'support_agent'));
  SELECT count(*) INTO missing_objects
  FROM (
    VALUES
      (to_regclass('tickets')),
      (to_regclass('ticket_comments')),
      (to_regclass('idx_tickets_updated_at')),
      (to_regclass('idx_tickets_standalone_requester_created'))
  ) AS expected(object_name)
  WHERE object_name IS NULL;
  IF permission_count <> 39 OR association_count <> 165 OR bad_grants <> 0
     OR missing_objects <> 0 THEN
    RAISE EXCEPTION
      'Phase 6 ticket postflight failed: permissions=% associations=% bad_grants=% missing_objects=%',
      permission_count, association_count, bad_grants, missing_objects;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN ('tickets', 'ticket_comments')
      AND column_name = 'organization_id'
      AND is_nullable <> 'YES'
  ) THEN
    RAISE EXCEPTION 'Phase 6 ticket postflight failed: organization columns are not nullable';
  END IF;
END $$;
