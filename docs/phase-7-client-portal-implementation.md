# Fase 7.4 — Integración del portal del cliente

Fecha: 28 de julio de 2026.

## Resultado

El portal `/portal` quedó conectado con IlvoxB para organizaciones, proyectos,
hitos, entregables, tickets, comentarios de cliente y acciones de resolución.
El área `/app` conserva sus fuentes transitorias y no fue migrada. Fase 7.5 no
fue iniciada.

## Contratos utilizados

Solo se consumen operaciones existentes:

- `GET /me`;
- `GET /api/v1/organizations/:organizationId`;
- `GET /api/v1/projects`;
- `GET /api/v1/projects/:projectId`;
- `GET /api/v1/projects/:projectId/milestones`;
- `GET /api/v1/projects/:projectId/deliverables`;
- `GET /api/v1/tickets`;
- `POST /api/v1/tickets`;
- `GET /api/v1/tickets/:ticketId`;
- `GET|POST /api/v1/tickets/:ticketId/comments`;
- `POST /api/v1/tickets/:ticketId/confirm`;
- `POST /api/v1/tickets/:ticketId/reopen`.

No se añadieron endpoints, campos OpenAPI, tablas ni migraciones. La creación de
ticket usa `requestedPriority`; nunca envía `requesterUserId`, assignee,
prioridad operativa, correo, metadata Clerk o un tenant tomado de la URL.

## Contexto de organización

La autoridad es `organizations` de `/me`:

- cero organizaciones: scope standalone, sin selector;
- una organización: selección automática;
- varias: selector explícito y sin consulta dependiente hasta seleccionar;
- al cambiar: se cancelan y eliminan todas las queries con prefijo `portal`;
- al cambiar usuario o cerrar sesión: se reconstruye el scope y se limpia cache;
- no se persiste scope en `localStorage` o `sessionStorage`.

La opción standalone no se ofrece a usuarios con organizaciones porque el
contrato de listado no expresa `organizationId IS NULL`. Para usuarios sin
organización, el scope SQL `own` ya limita el resultado a tickets standalone y
permite paginación real sin filtro local de tenant.

## Proyectos

Listado y detalle usan TanStack Query, filtros y paginación del servidor. El
detalle carga proyecto, hitos y entregables por separado para conservar errores
parciales y retry manual. Un UUID no autorizado o una respuesta cuyo
`organizationId` no coincide muestra `Recurso no disponible`. No se calcula ni
se muestra un campo ficticio `avance`.

Durante el smoke se detectó que `client_contact` recibía `own` antes de
`assigned` para `projects.read`; el repositorio no reconoce `own` para
proyectos y devolvía una lista vacía. La política quedó separada así:

- proyectos de `client_contact`: `assigned`;
- tickets/comentarios: `own` y `assigned`;
- demás recursos organizacionales: `organization`.

## Tickets y comentarios

El listado usa filtros reales, `page/pageSize` y abort signal. Crear, comentar,
confirmar, rechazar y reabrir tienen `retry: false` y bloqueo sincrónico contra
doble submit. Los formularios preservan texto ante error.

Confirmación, rechazo y reapertura envían `expectedUpdatedAt`. Rechazo y
reapertura exigen motivo. Ante `409`, el portal conserva el contenido, vuelve a
consultar ticket/comentarios y explica el conflicto sin sobrescribir la entrada.

Los comentarios se renderizan como texto plano. El POST fija
`visibility: "client"` y no muestra selector interno. Se cerraron dos defensas:

1. IlvoxB solo permite `includeInternal=true` cuando el actor es interno y el
   permiso `ticket_comments.read_internal` existe;
2. una identidad dual no ejecuta el GET de conversación desde `/portal`,
   porque el endpoint compartido no tiene un discriminador contractual de
   superficie. Debe usar el área interna para esa conversación.

El adaptador del portal también falla cerrado si una respuesta contiene una
visibilidad distinta de `client`.

## Resolución

Las acciones se muestran únicamente si coinciden permiso y estado:

- confirmar: `tickets.confirm_resolution` + `resolved`;
- rechazar: `tickets.reject_resolution` + `resolved`;
- reabrir: `tickets.request_reopen` + `closed`.

`PermissionGate` y estas condiciones son UX; IlvoxB vuelve a autorizar scope,
estado y concurrencia.

## Mocks retirados y capacidades ocultas

Se eliminaron los componentes mock ya reemplazados:

- `PortalLayout.tsx`;
- `PortalDashboard.tsx`;
- `MisProyectos.tsx`;
- `PortalProyectoDetalle.tsx`;
- `MisTickets.tsx`;
- `PortalTicketDetalle.tsx`.

`AppStore` y `seed.ts` no se eliminaron porque el área interna aún los consume.
El portal conectado no importa esas fuentes.

Siguen sin ruta o navegación de portal: archivos/documentos, tareas,
notificaciones, auditoría, RBAC, SLA, facturación, chat y métricas definitivas.

## Smoke PostgreSQL

`npm run smoke:phase74:portal` crea fixtures con prefijo
`PHASE74_SMOKE_` en dos organizaciones, ejerce HTTP real con un proveedor de
autenticación de prueba y limpia en `finally`.

Comprueba:

- `/me` y selección de la organización A;
- lista/detalle cross-tenant neutral;
- hitos y entregables de A;
- tickets standalone, organizacional y de proyecto;
- rechazo de creación en B;
- comentario cliente visible e interno oculto;
- confirmar, rechazar, reabrir y conflicto 409;
- cero usuarios, organizaciones, proyectos, tickets, comentarios o auditoría
  residuales.

## Límites

No se conectó el área interna. No se añadieron métricas, archivos, tareas,
notificaciones o funciones de Fase 7.5. No se usó Clerk Organizations ni
funciones Pro. La UI no sustituye la autorización PostgreSQL.
