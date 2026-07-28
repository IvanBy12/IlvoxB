-- Rollback controlado de Fase 6. Abortará si existen tickets o comentarios standalone.
DO $$
DECLARE
  standalone_tickets integer;
  standalone_comments integer;
  permission_count integer;
  association_count integer;
BEGIN
  SELECT count(*) INTO standalone_tickets FROM tickets WHERE organization_id IS NULL;
  SELECT count(*) INTO standalone_comments FROM ticket_comments WHERE organization_id IS NULL;
  SELECT count(*) INTO permission_count FROM permissions;
  SELECT count(*) INTO association_count
  FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d;
  IF standalone_tickets <> 0 OR standalone_comments <> 0 THEN
    RAISE EXCEPTION
      'Phase 6 rollback blocked: standalone_tickets=% standalone_comments=%',
      standalone_tickets, standalone_comments;
  END IF;
  IF permission_count <> 39 OR association_count <> 165 THEN
    RAISE EXCEPTION
      'Phase 6 rollback preflight failed: expected permissions=39 associations=165, got %/%',
      permission_count, association_count;
  END IF;
END $$;

DROP TRIGGER trg_ticket_comments_derive_organization ON ticket_comments;
DROP FUNCTION phase6_derive_ticket_comment_organization();

DELETE FROM permissions
WHERE code IN ('tickets.update', 'tickets.change_priority');

DROP INDEX idx_tickets_standalone_requester_created;
DROP INDEX idx_tickets_updated_at;
ALTER TABLE tickets DROP CONSTRAINT chk_tickets_project_requires_organization;
ALTER TABLE tickets DROP CONSTRAINT fk_tickets_project_id;
ALTER TABLE ticket_comments DROP CONSTRAINT fk_ticket_comments_ticket_id;
ALTER TABLE ticket_comments ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE tickets ALTER COLUMN organization_id SET NOT NULL;

DO $$
DECLARE
  permission_count integer;
  association_count integer;
BEGIN
  SELECT count(*) INTO permission_count FROM permissions;
  SELECT count(*) INTO association_count
  FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d;
  IF permission_count <> 37 OR association_count <> 159 THEN
    RAISE EXCEPTION
      'Phase 6 rollback postflight failed: expected permissions=37 associations=159, got %/%',
      permission_count, association_count;
  END IF;
END $$;
