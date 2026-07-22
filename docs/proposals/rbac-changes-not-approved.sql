-- PROPUESTA NO APROBADA
-- NO EJECUTAR EN PRODUCCIÓN
-- NO FORMA PARTE DEL FLUJO AUTOMÁTICO DE MIGRACIONES
-- Este borrador no fue ejecutado. Cambiar ROLLBACK requiere aprobación formal.

BEGIN;

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
  ('files.read_client', 'files', 'Consultar archivos de cliente', 'Leer archivos con audiencia cliente demostrada y alcance autorizado.'),
  ('files.upload_client', 'files', 'Cargar archivos de cliente', 'Cargar archivos únicamente en padres con audiencia cliente autorizada.')
ON CONFLICT (code) DO NOTHING;

-- Retirar once asociaciones amplias o ambiguas.
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
JOIN permissions p ON p.code = g.permission_code
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Partiendo exactamente de la semilla auditada se esperan 36/157/157.
SELECT
  (SELECT count(*) FROM permissions) AS permissions,
  (SELECT count(*) FROM role_permissions) AS associations,
  (SELECT count(*) FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d)
    AS distinct_associations;

-- Impacto a revisar antes de cualquier aplicación futura.
SELECT ur.user_id, r.scope, r.code
FROM user_roles ur JOIN roles r ON r.id = ur.role_id
WHERE r.scope = 'global' AND r.code = 'admin'
UNION ALL
SELECT om.user_id, r.scope, r.code
FROM organization_memberships om JOIN roles r ON r.id = om.role_id
WHERE r.scope = 'organization' AND r.code IN ('client_manager', 'client_contact');

-- Rollback futuro: reinsertar las 11 asociaciones retiradas, eliminar los 26
-- grants nuevos y después los 13 permisos solo si no tienen dependencias.
-- Verificar retorno a 23 permisos y 142 asociaciones distintas.

ROLLBACK;
