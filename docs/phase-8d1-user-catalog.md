# Fase 8D.1 — catálogo seguro de usuarios

## Contratos y autorización

`GET /api/v1/users` y `GET /api/v1/users/:userId` exponen el catálogo local administrativo. Requieren actor interno activo y el permiso global existente `users.manage`; no se añadió RBAC. El listado soporta búsqueda, página/tamaño, `status`, `type=internal|client`, `role`, campo y dirección de orden. Solo devuelve identificador local, nombre, correo, estado, naturaleza interna, roles efectivos, creación y `lastAccessAt`. El modelo no registra último acceso, por lo que `lastAccessAt` es `null`; no se reutiliza `last_synced_at` ni se crea tracking ficticio.

`GET /api/v1/users/eligible` acepta un `purpose` estricto y un contexto compatible. La lectura exige actor interno y reutiliza la capacidad de la operación: `organizations.manage`, `projects.manage`, `tasks.manage`, `tickets.assign` o `leads.manage`. El repositorio aplica el mismo tipo de filtro SQL neutral que los recursos operativos; un contexto ausente o fuera de scope responde 404. La respuesta reducida contiene solo `id`, `displayName`, `email` y `roles`.

| Purpose | Contexto | Elegibilidad |
| --- | --- | --- |
| `organization_account_manager` | ninguno o `organizationId` | interno activo con `organizations.manage` global |
| `project_lead` | exactamente `organizationId` o `projectId` | interno activo con `projects.manage` global |
| `project_member` | exactamente `projectId` | interno activo con `projects.read`, o cliente con membership activa en la organización; excluye miembros ya registrados |
| `task_assignee` | standalone sin contexto, o exactamente `projectId`/`taskId` | standalone: interno activo con `tasks.manage`; proyecto: miembro activo, líder o interno con `tasks.manage` global |
| `ticket_assignee` | exactamente `ticketId` | interno activo con `tickets.assign` global o permiso de proyecto aplicable; nunca clientes |
| `lead_assignee` | exactamente `leadId` | interno activo con `leads.manage` global |

La elegibilidad y las validaciones de escritura se basan en joins `role_permissions`/`permissions`, no en comparaciones con el código `super_admin`. Por ello una instalación unipersonal devuelve al único operador en todos los propósitos para los que sus capacidades efectivas aplican, permite seleccionarse a sí mismo y no necesita seeds adicionales.

## Integración y límites

El frontend consume un selector reutilizable con cache separada por purpose/contexto, búsqueda, loading, vacío, error y retry manual. Se usa para responsable de organización, líder y miembro de proyecto, tareas, prospectos y tickets. No consulta Clerk ni filtra un catálogo global. La desasignación se conserva solo donde el contrato ya acepta `null` (tickets); tareas, prospectos y líder continúan requiriendo usuario.

No hay migración: `app_users`, RBAC, memberships y recursos actuales cubren el contrato. OpenAPI 0.8.3 documenta las tres rutas, combinaciones contextuales y respuesta mínima. No se modificó el flujo de invitaciones de clientes, no se creó invitación de empleados y no se inició 8D.2.
