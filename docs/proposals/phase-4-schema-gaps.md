# Propuestas no aprobadas para cerrar Fase 4

Este documento conserva propuestas; no es una migración aplicable.

## P-4.1 — permiso `services.manage` — resuelto en Fase 4.5

Agregar un permiso de módulo `services` separado de `services.read`, asignado como mínimo a
`super_admin` y solo a los roles internos que apruebe el propietario. Requiere:

1. migración RBAC con guardas de catálogo/matriz;
2. rollback;
3. actualización de auditorías RBAC;
4. decisión explícita sobre roles receptores;
5. entonces implementar `POST/PATCH /api/v1/services`.

La migración 0005 implementa este permiso únicamente para super_admin y admin. Continúa
prohibido conceder escritura mediante `services.read` o `system.configure`.

## P-4.2 — contactos empresariales

Crear una entidad `organization_contacts` independiente, como mínimo con:

- UUID y `organization_id`;
- nombre, correo y teléfono empresariales;
- cargo y flag de contacto principal;
- estado operativo;
- fechas;
- índices/scopes y reglas de duplicado explícitas.

La relación opcional con `app_users` debe decidirse por ID local explícito, nunca por correo.
La conversión solo podrá crear el contacto principal después de aprobar y validar esta
migración. No usar `organization_memberships` como contacto ni crear invitaciones Clerk.

Antes de aplicar cualquiera: baseline, migración, rollback, catálogo, constraints, Drizzle,
paridad y pruebas PostgreSQL 18.4 deben repetirse para el cambio.

## P-4.3 — edición acotada del perfil por `client_manager`

El catálogo actual solo concede `organizations.read` al cliente. Si se desea que
`client_manager` edite nombre comercial, industria o tamaño, crear un permiso separado
como `organizations.manage_profile`, de scope `organization`, sin incluir estado, datos
fiscales, nombre legal ni responsable de cuenta.

No conceder `organizations.manage` global ni tratar `organizations.read` como escritura.
La migración RBAC debe incluir guardas, rollback, matriz y pruebas A/B.
