# API de tickets de Fase 6

Base: `/api/v1`. Todas las rutas requieren sesión Clerk válida y usuario local
activo.

| Método | Ruta | Permiso principal |
| --- | --- | --- |
| GET | `/tickets` | `tickets.read` o capacidad propia |
| POST | `/tickets` | `tickets.create` o capacidad standalone propia |
| GET | `/tickets/:ticketId` | `tickets.read` o capacidad propia |
| PATCH | `/tickets/:ticketId` | `tickets.update` o capacidad propia |
| POST | `/tickets/:ticketId/assign` | `tickets.assign` |
| POST | `/tickets/:ticketId/priority` | `tickets.change_priority` |
| POST | `/tickets/:ticketId/transition` | permiso según transición |
| POST | `/tickets/:ticketId/confirm` | confirmar o rechazar resolución |
| POST | `/tickets/:ticketId/reopen` | `tickets.request_reopen` |
| GET | `/tickets/:ticketId/comments` | ticket visible; internos por permiso |
| POST | `/tickets/:ticketId/comments` | crear comentario cliente o interno |

El listado soporta paginación, búsqueda, estado, prioridad, organización,
proyecto, solicitante, asignado, rangos de creación/actualización y orden
whitelist. Datos y conteo reutilizan exactamente el mismo `WHERE` scoped.

`PATCH` solo acepta `subject`, `description`, `requestedPriority` y
`expectedUpdatedAt`. La prioridad operativa, asignación y estado tienen rutas
explícitas. Todos los bodies son cerrados (`additionalProperties: false`).

La creación sin organización/proyecto produce un ticket standalone privado.
Con proyecto, la organización se deriva del proyecto bloqueado. Proyectos
`delivered` o `cancelled` rechazan tickets nuevos.

OpenAPI: `docs/openapi.json`, versión 0.6.0, 55 operaciones totales. No contiene
rutas de archivos, almacenamiento, SLA o notificaciones.
