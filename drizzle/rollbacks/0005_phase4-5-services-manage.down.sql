BEGIN;

DO $$
DECLARE
  permission_count integer;
  target_grants integer;
  unauthorized_grants integer;
BEGIN
  SELECT count(*) INTO permission_count
  FROM permissions WHERE code = 'services.manage';
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

  IF permission_count <> 1 OR target_grants <> 2 OR unauthorized_grants <> 0 THEN
    RAISE EXCEPTION
      'services.manage rollback preflight mismatch: permission=% targets=% unauthorized=%',
      permission_count, target_grants, unauthorized_grants;
  END IF;
END $$;

DELETE FROM role_permissions rp
USING permissions p
WHERE rp.permission_id = p.id AND p.code = 'services.manage';

DELETE FROM permissions WHERE code = 'services.manage';

DO $$
DECLARE
  permission_count integer;
  association_count integer;
  distinct_association_count integer;
BEGIN
  SELECT count(*) INTO permission_count FROM permissions;
  SELECT count(*) INTO association_count FROM role_permissions;
  SELECT count(*) INTO distinct_association_count
  FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d;

  IF permission_count <> 36 OR association_count <> 157
     OR distinct_association_count <> 157 THEN
    RAISE EXCEPTION
      'services.manage rollback result mismatch: permissions=% associations=%/%',
      permission_count, association_count, distinct_association_count;
  END IF;
END $$;

COMMIT;
