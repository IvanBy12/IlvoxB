BEGIN;

DO $$
DECLARE
  role_count integer;
  permission_count integer;
  association_count integer;
  distinct_association_count integer;
  existing_permission_count integer;
  target_role_count integer;
BEGIN
  SELECT count(*) INTO role_count FROM roles;
  SELECT count(*) INTO permission_count FROM permissions;
  SELECT count(*) INTO association_count FROM role_permissions;
  SELECT count(*) INTO distinct_association_count
  FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d;
  SELECT count(*) INTO existing_permission_count
  FROM permissions WHERE code = 'services.manage';
  SELECT count(*) INTO target_role_count
  FROM roles
  WHERE scope = 'global' AND code IN ('super_admin', 'admin');

  IF role_count <> 11 OR permission_count <> 36
     OR association_count <> 157 OR distinct_association_count <> 157
     OR existing_permission_count <> 0 OR target_role_count <> 2 THEN
    RAISE EXCEPTION
      'services.manage preflight mismatch: roles=% permissions=% associations=%/% existing=% targets=%',
      role_count, permission_count, association_count, distinct_association_count,
      existing_permission_count, target_role_count;
  END IF;
END $$;

INSERT INTO permissions (code, module, name, description)
VALUES (
  'services.manage',
  'services',
  'Gestionar servicios',
  'Crear y modificar el catálogo operativo de servicios sin eliminación física.'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'services.manage'
WHERE r.scope = 'global' AND r.code IN ('super_admin', 'admin');

DO $$
DECLARE
  permission_count integer;
  association_count integer;
  distinct_association_count integer;
  target_grants integer;
  unauthorized_grants integer;
BEGIN
  SELECT count(*) INTO permission_count FROM permissions;
  SELECT count(*) INTO association_count FROM role_permissions;
  SELECT count(*) INTO distinct_association_count
  FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d;
  SELECT count(*) INTO target_grants
  FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
  WHERE p.code = 'services.manage'
    AND r.scope = 'global'
    AND r.code IN ('super_admin', 'admin');
  SELECT count(*) INTO unauthorized_grants
  FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
  WHERE p.code = 'services.manage'
    AND NOT (r.scope = 'global' AND r.code IN ('super_admin', 'admin'));

  IF permission_count <> 37 OR association_count <> 159
     OR distinct_association_count <> 159
     OR target_grants <> 2 OR unauthorized_grants <> 0 THEN
    RAISE EXCEPTION
      'services.manage result mismatch: permissions=% associations=%/% targets=% unauthorized=%',
      permission_count, association_count, distinct_association_count,
      target_grants, unauthorized_grants;
  END IF;
END $$;

COMMIT;
