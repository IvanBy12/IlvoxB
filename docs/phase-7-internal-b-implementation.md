# Fase 7.5B — Implementación interna

Fecha de cierre técnico: 4 de agosto de 2026.

## Punto recuperado al iniciar

La sesión anterior sí había iniciado 7.5B. El frontend contenía cambios sin confirmar en
`projects.api.ts`, `use-internal-api.ts`, `ProyectoDetalle.tsx`, `Proyectos.tsx`,
`Tareas.tsx` y `tests/internal.test.ts`, más los archivos nuevos `tasks.api.ts` y
`transition-policy.ts`. El backend contenía `smoke-phase75b-internal.ts` sin seguimiento y
el script npm asociado. No existía documentación 7.5B.

Clasificación inicial basada en el código recuperado:

| Bloque | Estado inicial | Evidencia |
| --- | --- | --- |
| Proyectos | PARCIAL | Listado, CRUD y transición reales presentes; el refetch de un 409 reemplazaba el formulario abierto. |
| Miembros | PARCIAL | Listado, rol y revocación presentes; feedback y doble acción de revocación incompletos. |
| Hitos | PARCIAL | CRUD real presente; faltaban bloqueo de doble submit, labels completos y error aislado. |
| Entregables | PARCIAL | CRUD/estado multivalor presentes; faltaban bloqueo, labels y validación frontend de hito scoped. |
| Tareas standalone | PARCIAL | Listado/CRUD/transición reales; faltaba asignación real y el 409 podía reemplazar el formulario. |
| Tareas de proyecto | PARCIAL | Filtro/creación existían; el detalle de proyecto solo enlazaba a tareas y un `projectId` URL ajeno podía degradar a standalone. |
| Pruebas y smoke | PARCIAL | Había tests de contrato y un smoke nuevo, pero el smoke no cubría varios negativos ni había resultados documentados. |
| Documentación | NO INICIADO | Los dos documentos 7.5B no existían y matriz/plan/readiness aún indicaban “no iniciada”. |

No se encontró ningún bloque `BLOQUEADO POR CONTRATO` para sus operaciones principales.
Las acciones dependientes de descubrimiento general de usuarios sí permanecen diferidas.

## Implementación completada

- Proyectos: listado, búsqueda, estado, orden, paginación de servidor, detalle, creación,
  edición con `expectedUpdatedAt`, transiciones adyacentes y 404 scoped neutral.
- Miembros: listado real, rol/estado real, edición de rol y revocación confirmada. Añadir
  miembro continúa deshabilitado por falta de catálogo seguro.
- Hitos: listado/detalle contractual, creación, edición/estado, fechas limitadas al rango
  real del proyecto, concurrencia y loading/error/retry independientes.
- Entregables: listado/detalle, creación, edición, hito opcional del mismo proyecto,
  estados multivalor y aprobación/rechazo mediante el PATCH contractual.
- Tareas: listado/búsqueda/filtros/paginación, detalle, creación standalone y de proyecto,
  edición, minutos enteros, transiciones adyacentes y asignación a candidatos ya conocidos.
- El detalle de proyecto muestra ahora las diez tareas reales más recientes, con estado,
  vencimiento, estimación y acceso a la lista paginada completa.
- Los formularios de proyecto y tarea conservan el texto tras `409`: el refetch actualiza
  la versión visible sin reinicializar el formulario abierto.
- Un `projectId` manipulado o fuera de scope ya no puede convertirse silenciosamente en
  una tarea standalone; se presenta `Recurso no disponible`.
- Se separó feedback de proyecto, miembros, hitos, entregables y tareas. Las mutaciones
  usan `retry: false`, locks de submit y botones deshabilitados durante la operación.
- Las fechas civiles `YYYY-MM-DD` se formatean como fechas locales, sin retroceder un día
  por la conversión UTC.
- Nombres contractuales largos hacen wrap; el único scroll horizontal móvil queda
  contenido dentro de la tabla responsive de tareas.

## Contratos utilizados

- `GET/POST /api/v1/projects`
- `GET/PATCH /api/v1/projects/:projectId`
- `POST /api/v1/projects/:projectId/transition`
- `GET /api/v1/projects/:projectId/members`
- `PATCH /api/v1/projects/:projectId/members/:memberId`
- `POST /api/v1/projects/:projectId/members/:memberId/revoke`
- `GET/POST /api/v1/projects/:projectId/milestones`
- `GET/PATCH /api/v1/projects/:projectId/milestones/:milestoneId`
- `GET/POST /api/v1/projects/:projectId/deliverables`
- `GET/PATCH /api/v1/projects/:projectId/deliverables/:deliverableId`
- `GET/POST /api/v1/tasks`
- `GET/PATCH /api/v1/tasks/:taskId`
- `POST /api/v1/tasks/:taskId/assign`
- `POST /api/v1/tasks/:taskId/transition`

Las listas de proyectos y tareas usan envelopes paginados. Miembros, hitos y entregables
usan arrays porque ese es el contrato actual del backend. No se modificó OpenAPI.

## Asignación segura y acciones diferidas

La creación de proyecto usa como líder inicial al usuario local autenticado. La creación
standalone usa el mismo usuario, y una tarea de proyecto usa el líder real devuelto por
el proyecto. En edición de tareas solo se ofrecen como candidatos el usuario autenticado
y el líder real del proyecto cuando difieren del assignee actual.

Permanecen diferidos:

- buscar y añadir un miembro nuevo;
- cambiar el líder mediante un selector general;
- selector general de assignees;
- desasignar una tarea: `TaskAssignBodySchema` exige `assignedToUserId` UUID y no acepta
  `null`;
- archivos, versiones, descargas, uploads e historial documental.

No se consultó Clerk desde el navegador, no se usaron usuarios seed y no se inventaron
endpoints. `AppStore` y `seed.ts` permanecen para los módulos aún pendientes, pero las
pantallas 7.5B no los importan.

## Seguridad y alcance

El backend continúa autorizando con `/me`, permisos y scopes PostgreSQL. El smoke final
probó lectura propia, lectura ajena neutral `404`, escritura cross-tenant `403`, miembro,
hito, entregable y tarea de otro proyecto, asociación de hito cruzada, transición inválida
y concurrencia `409`. `PermissionGate` solo protege experiencia de usuario.

No se crearon migraciones, no cambiaron tablas, constraints, RBAC ni OpenAPI. No se
inició 7.5C, Prospectos, Tickets internos, Personal ni 7.6.

## Estado final

Los ocho bloques recuperados quedan `COMPLETADO` dentro del contrato disponible. Las
acciones de descubrimiento/desasignación enumeradas arriba son diferidas contractuales y
no bloquean las operaciones principales.

**Decisión: FASE 7.5B CERRADA TÉCNICAMENTE.**
