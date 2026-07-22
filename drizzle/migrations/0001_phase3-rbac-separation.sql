-- Fase 3: separación RBAC aprobada. No aplicar sin validar la baseline.
DO $$
DECLARE
  role_count integer;
  permission_count integer;
  association_count integer;
  distinct_association_count integer;
BEGIN
  SELECT count(*) INTO role_count FROM roles;
  SELECT count(*) INTO permission_count FROM permissions;
  SELECT count(*) INTO association_count FROM role_permissions;
  SELECT count(*) INTO distinct_association_count
  FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d;
  IF role_count <> 11 OR permission_count <> 23 OR association_count <> 142
     OR distinct_association_count <> 142 THEN
    RAISE EXCEPTION 'RBAC baseline mismatch: expected roles=11 permissions=23 associations=142/142, got % % %/%',
      role_count, permission_count, association_count, distinct_association_count;
  END IF;
END $$;--> statement-breakpoint

INSERT INTO permissions (code, module, name, description)
VALUES
  ('tickets.confirm_resolution', 'tickets', 'Confirmar resolución', 'Confirmar la resolución de un ticket propio o autorizado.'),
  ('tickets.reject_resolution', 'tickets', 'Rechazar resolución', 'Rechazar con motivo la resolución de un ticket propio o autorizado.'),
  ('tickets.request_reopen', 'tickets', 'Solicitar reapertura', 'Solicitar una reapertura controlada sin elegir el estado final.'),
  ('organization_members.manage', 'organizations', 'Gestionar miembros no privilegiados', 'Gestionar membresías cliente dentro de una organización autorizada.'),
  ('users.manage_non_privileged', 'users', 'Gestionar usuarios no privilegiados', 'Gestionar perfiles locales inferiores sin alterar privilegios.'),
  ('audit.read_scoped', 'audit', 'Consultar auditoría acotada', 'Consultar auditoría dentro de organizaciones autorizadas.'),
  ('permissions.manage', 'roles', 'Gestionar permisos globales', 'Administrar catálogo y matriz global con controles reforzados.'),
  ('roles.assign_super_admin', 'roles', 'Asignar superadministradores', 'Asignar o revocar super_admin con controles reforzados.'),
  ('security.manage', 'security', 'Gestionar seguridad global', 'Gestionar sesiones globales, incidentes y política de identidad.'),
  ('system.configure', 'system', 'Configurar sistema', 'Modificar configuración global no secreta y versionada.'),
  ('organizations.access_all', 'organizations', 'Acceso transversal', 'Ampliar alcance organizacional solo para acciones ya autorizadas.'),
  ('files.read_client', 'files', 'Consultar archivos de organización', 'Leer archivos organization dentro del alcance autorizado.'),
  ('files.upload_client', 'files', 'Cargar archivos de organización', 'Cargar archivos organization dentro del alcance autorizado.');--> statement-breakpoint

DO $$
DECLARE removed integer;
BEGIN
  DELETE FROM role_permissions rp
  USING roles r, permissions p
  WHERE rp.role_id = r.id AND rp.permission_id = p.id
    AND (
      (r.scope = 'global' AND r.code = 'admin'
       AND p.code IN ('roles.manage', 'users.manage', 'audit.read'))
      OR
      (r.scope = 'organization' AND r.code IN ('client_manager', 'client_contact')
       AND p.code IN ('tickets.change_status', 'tickets.close', 'files.read', 'files.upload'))
    );
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed <> 11 THEN RAISE EXCEPTION 'Expected to remove 11 RBAC associations, removed %', removed; END IF;
END $$;--> statement-breakpoint

WITH proposed_grants (role_scope, role_code, permission_code) AS (
  VALUES
    ('global', 'super_admin', 'tickets.confirm_resolution'),
    ('global', 'super_admin', 'tickets.reject_resolution'),
    ('global', 'super_admin', 'tickets.request_reopen'),
    ('global', 'super_admin', 'organization_members.manage'),
    ('global', 'super_admin', 'users.manage_non_privileged'),
    ('global', 'super_admin', 'audit.read_scoped'),
    ('global', 'super_admin', 'permissions.manage'),
    ('global', 'super_admin', 'roles.assign_super_admin'),
    ('global', 'super_admin', 'security.manage'),
    ('global', 'super_admin', 'system.configure'),
    ('global', 'super_admin', 'organizations.access_all'),
    ('global', 'super_admin', 'files.read_client'),
    ('global', 'super_admin', 'files.upload_client'),
    ('global', 'admin', 'users.manage_non_privileged'),
    ('global', 'admin', 'audit.read_scoped'),
    ('organization', 'client_manager', 'tickets.confirm_resolution'),
    ('organization', 'client_manager', 'tickets.reject_resolution'),
    ('organization', 'client_manager', 'tickets.request_reopen'),
    ('organization', 'client_manager', 'organization_members.manage'),
    ('organization', 'client_manager', 'files.read_client'),
    ('organization', 'client_manager', 'files.upload_client'),
    ('organization', 'client_contact', 'tickets.confirm_resolution'),
    ('organization', 'client_contact', 'tickets.reject_resolution'),
    ('organization', 'client_contact', 'tickets.request_reopen'),
    ('organization', 'client_contact', 'files.read_client'),
    ('organization', 'client_contact', 'files.upload_client')
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM proposed_grants g
JOIN roles r ON r.scope = g.role_scope AND r.code = g.role_code
JOIN permissions p ON p.code = g.permission_code;--> statement-breakpoint

DO $$
DECLARE
  permission_count integer;
  association_count integer;
  sensitive_leaks integer;
BEGIN
  SELECT count(*) INTO permission_count FROM permissions;
  SELECT count(*) INTO association_count FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d;
  SELECT count(*) INTO sensitive_leaks
  FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id
  WHERE p.code IN ('permissions.manage','roles.assign_super_admin','security.manage','system.configure','organizations.access_all')
    AND NOT (r.scope='global' AND r.code='super_admin');
  IF permission_count <> 36 OR association_count <> 157 OR sensitive_leaks <> 0 THEN
    RAISE EXCEPTION 'RBAC result mismatch: expected permissions=36 associations=157 sensitive_leaks=0, got % % %',
      permission_count, association_count, sensitive_leaks;
  END IF;
END $$;
