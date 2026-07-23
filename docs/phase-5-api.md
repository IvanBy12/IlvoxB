# API de Fase 5

Base: `/api/v1`. Todas las operaciones requieren sesión Clerk válida, perfil local activo,
permiso efectivo y scope SQL. La respuesta conserva el envelope común `data`/`error`.

## Proyectos

| Método | Ruta | Permiso | Regla principal |
| --- | --- | --- | --- |
| GET | `/projects` | `projects.read` | scope en consulta y conteo; paginación/filtros |
| POST | `/projects` | `projects.manage` | organización obligatoria; estado `planning` |
| GET | `/projects/:projectId` | `projects.read` | 404 si falta o está fuera de scope |
| PATCH | `/projects/:projectId` | `projects.manage` | solo datos generales |
| POST | `/projects/:projectId/assign` | `projects.manage` | responsable interno activo |
| POST | `/projects/:projectId/transition` | `projects.manage` | máquina central y lock |

Filtros: `search`, `status`, `organizationId`, `leadUserId`, `startFrom`, `dueTo`.
Orden: `createdAt|updatedAt|name|startDate|dueDate`, `asc|desc`.

## Miembros

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/projects/:projectId/members` | `projects.read` |
| POST | `/projects/:projectId/members` | `projects.manage` |
| PATCH | `/projects/:projectId/members/:memberId` | `projects.manage` |

Roles aceptados: `project_lead`, `project_member`, `project_viewer`. PATCH cambia solo rol.
No existe revocación porque el esquema no puede preservarla.

## Hitos y entregables

| Método | Ruta |
| --- | --- |
| GET/POST | `/projects/:projectId/milestones` |
| GET/PATCH | `/projects/:projectId/milestones/:milestoneId` |
| GET/POST | `/projects/:projectId/deliverables` |
| GET/PATCH | `/projects/:projectId/deliverables/:deliverableId` |

Lectura requiere `projects.read`; escritura, `projects.manage`. Organización se deriva del
proyecto. Hitos se limitan al rango de fechas del proyecto. Entregables no aceptan
`milestoneId`, archivos ni URLs.

## Tareas

| Método | Ruta | Regla principal |
| --- | --- | --- |
| GET | `/tasks` | scope en consulta/conteo; excluye tickets |
| POST | `/tasks` | proyecto opcional; sin proyecto crea standalone interna |
| GET | `/tasks/:taskId` | 404 si falta o está fuera de scope |
| PATCH | `/tasks/:taskId` | datos generales; contexto protegido |
| POST | `/tasks/:taskId/assign` | elegibilidad contextual |
| POST | `/tasks/:taskId/transition` | máquina central y lock |

Filtros: `search`, `status`, `organizationId`, `projectId`, `assignedToUserId`,
`createdByUserId`, `dueFrom`, `dueTo`. Orden:
`createdAt|updatedAt|title|dueDate`, `asc|desc`.

POST no acepta `ticketId` ni `organizationId`. El assignee inicial es obligatorio porque
`tasks.assigned_to_user_id` es `NOT NULL`.

## Errores y concurrencia

- 400: formato, body cerrado, estado/fecha/usuario no elegible.
- 401: no autenticado.
- 403: permiso o modalidad standalone denegados.
- 404: inexistente o fuera de scope.
- 409: transición, terminal, duplicado o `expectedUpdatedAt` obsoleto.
- 500/503: error interno o indisponibilidad real según el manejador común.

El contrato completo, schemas y estados están en `openapi.json`, versión 0.5.0, con
exactamente 43 operaciones totales.
