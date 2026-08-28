# Fase 8D.3 — Personal

## Alcance

`/app/personal` administra únicamente colaboradores internos. El catálogo se obtiene de PostgreSQL mediante `GET /api/v1/users?type=internal`, con búsqueda, filtros por estado/rol, paginación real y resumen de estados. Las invitaciones pendientes, reenvío y revocación reutilizan exclusivamente los contratos separados de 8D.2. Los clientes continúan administrándose desde los accesos de cada organización.

La operación unipersonal es válida: el operador aparece como único colaborador, permanece elegible y puede seguir invitando clientes o futuros colaboradores. No se generan empleados ficticios. `lastAccessAt` continúa en `null` y la interfaz muestra “Sin registro”; no se añadió tracking artificial.

## Detalle y administración

`GET /api/v1/users/:userId` devuelve solo colaboradores internos e incluye roles globales asignados, indicador de identidad sincronizada, presencia de acceso cliente sin revelar organizaciones ni Clerk IDs, y permisos efectivos calculados en PostgreSQL. Los permisos son de solo lectura y siempre se derivan de roles.

Las operaciones son intencionales:

- `POST /api/v1/users/:userId/activate`: `pending → active`, `blocked → active`; `active` es idempotente.
- `POST /api/v1/users/:userId/block`: `active → blocked`; `blocked` es idempotente.
- `POST /api/v1/users/:userId/roles`: asigna un rol global existente y asignable.
- `DELETE /api/v1/users/:userId/roles/:roleCode`: retira un rol global de forma idempotente.

`deleted` es terminal. Bloquear acceso interno no borra usuarios, historial, asignaciones ni memberships cliente. Cada colaborador conserva al menos un rol interno; para retirar acceso se usa el estado bloqueado. Los targets sin rol interno responden con 404 neutral. Los roles cliente, inexistentes o superiores a las capacidades efectivas del actor no son asignables. Personal muestra `super_admin`, pero no permite crearlo ni retirarlo.

## Protección y consistencia

Todas las mutaciones requieren actor interno activo con `users.manage`, usan transacción y un bloqueo asesor de PostgreSQL. Antes de bloquear o retirar una capacidad administrativa se comprueba, por permiso efectivo `users.manage`, que permanezca otro administrador activo. Si no, se responde `409 LAST_ADMINISTRATOR_PROTECTED`; no existen excepciones por email o UUID.

La auditoría registra `internal_user.activated`, `internal_user.blocked`, `internal_user.reactivated`, `internal_user.role_granted` e `internal_user.role_revoked`. El frontend usa TanStack Query, `retry: false`, exclusión de doble submit, conserva `requestId` y refresca `users`/`users/eligible` después de cambios. Un `409` conserva el estado visible y provoca refetch.

No se añadió migración: `app_users`, `user_roles`, `roles`, `role_permissions` y `audit_events` ya soportaban el contrato. Tampoco se implementaron RR. HH., permisos individuales, edición de permisos, creación de roles ni administración de RBAC.
