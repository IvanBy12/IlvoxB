# API de Fase 5

Base: `/api/v1`. Todas las operaciones requieren sesión válida, perfil local activo, permiso
efectivo y scope SQL. El contrato completo está en `openapi.json`, versión 0.5.1, con 44
operaciones totales y 24 de Fase 5.

## Proyectos y miembros

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET/POST | `/projects` | `projects.read` / `projects.manage` |
| GET/PATCH | `/projects/:projectId` | `projects.read` / `projects.manage` |
| POST | `/projects/:projectId/assign` | `projects.manage` |
| POST | `/projects/:projectId/transition` | `projects.manage` |
| GET/POST | `/projects/:projectId/members` | `projects.read` / `projects.manage` |
| PATCH | `/projects/:projectId/members/:memberId` | `projects.manage` |
| POST | `/projects/:projectId/members/:memberId/revoke` | `projects.manage` |

Los roles aceptados son `project_lead`, `project_member` y `project_viewer`. El cambio de rol
acepta `expectedUpdatedAt`. La revocación acepta opcionalmente `expectedUpdatedAt`, preserva
historial y es idempotente; los listados operativos muestran solo miembros activos.

## Hitos y entregables

| Método | Ruta |
| --- | --- |
| GET/POST | `/projects/:projectId/milestones` |
| GET/PATCH | `/projects/:projectId/milestones/:milestoneId` |
| GET/POST | `/projects/:projectId/deliverables` |
| GET/PATCH | `/projects/:projectId/deliverables/:deliverableId` |

Lectura requiere `projects.read`; escritura requiere `projects.manage`. `milestoneId` es
opcional en un entregable. En PATCH, un UUID asigna/cambia el hito y `null` lo retira. La API
responde 404 si el hito no existe o no pertenece al proyecto autorizado; la base de datos
también impide vínculos entre proyectos u organizaciones.

## Tareas

Las rutas `GET/POST /tasks`, `GET/PATCH /tasks/:taskId`, `/assign` y `/transition` mantienen
los filtros y scopes de Fase 5. Las tareas de ticket se excluyen. Una tarea standalone solo
puede ser creada o vista por actores internos según permiso y scope; un miembro revocado deja
de obtener acceso derivado al proyecto.

## Errores

- 400: formato, body cerrado, estado, fecha o usuario no elegible.
- 401: no autenticado.
- 403: permiso o modalidad standalone denegados.
- 404: inexistente o fuera de scope.
- 409: duplicado, estado terminal, transición o versión obsoleta.
- 500/503: fallo interno o indisponibilidad real.
