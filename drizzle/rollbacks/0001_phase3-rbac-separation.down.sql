BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM permissions) <> 36
     OR (SELECT count(*) FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d) <> 157 THEN
    RAISE EXCEPTION 'RBAC rollback precondition failed: expected 36 permissions and 157 associations';
  END IF;
END $$;

DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id=r.id AND rp.permission_id=p.id
  AND ((r.scope='global' AND r.code='super_admin' AND p.code IN (
    'tickets.confirm_resolution','tickets.reject_resolution','tickets.request_reopen',
    'organization_members.manage','users.manage_non_privileged','audit.read_scoped',
    'permissions.manage','roles.assign_super_admin','security.manage','system.configure',
    'organizations.access_all','files.read_client','files.upload_client'))
  OR (r.scope='global' AND r.code='admin' AND p.code IN ('users.manage_non_privileged','audit.read_scoped'))
  OR (r.scope='organization' AND r.code='client_manager' AND p.code IN (
    'tickets.confirm_resolution','tickets.reject_resolution','tickets.request_reopen',
    'organization_members.manage','files.read_client','files.upload_client'))
  OR (r.scope='organization' AND r.code='client_contact' AND p.code IN (
    'tickets.confirm_resolution','tickets.reject_resolution','tickets.request_reopen',
    'files.read_client','files.upload_client')));

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE (r.scope='global' AND r.code='admin' AND p.code IN ('roles.manage','users.manage','audit.read'))
   OR (r.scope='organization' AND r.code IN ('client_manager','client_contact')
       AND p.code IN ('tickets.change_status','tickets.close','files.read','files.upload'))
ON CONFLICT DO NOTHING;

DELETE FROM permissions WHERE code IN (
  'tickets.confirm_resolution','tickets.reject_resolution','tickets.request_reopen',
  'organization_members.manage','users.manage_non_privileged','audit.read_scoped',
  'permissions.manage','roles.assign_super_admin','security.manage','system.configure',
  'organizations.access_all','files.read_client','files.upload_client');

DO $$
BEGIN
  IF (SELECT count(*) FROM permissions) <> 23
     OR (SELECT count(*) FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d) <> 142 THEN
    RAISE EXCEPTION 'RBAC rollback result mismatch';
  END IF;
END $$;

COMMIT;
