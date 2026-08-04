# Fase 7.0 — Matriz de integración IlvoxF ↔ IlvoxB

Fecha de corte: 4 de agosto de 2026. Todos los endpoints de negocio se muestran con su
prefijo real `/api/v1`. `/me` es una excepción histórica sin prefijo.

## Criterios

- `READY_DIRECT`: contrato y UX pueden conectarse sin rediseño de dominio.
- `READY_WITH_ADAPTATION`: existe endpoint, pero exige adaptar campos, estado, scope o UX.
- `BACKEND_MISSING`: existe UI, no existe operación funcional.
- `FRONTEND_MISSING`: existe operación, no existe UI.
- `HIDE_TEMPORARILY`: no debe exponerse durante Fase 7.
- `KEEP_STATIC`: contenido comercial sin API.
- `REMOVE`: duplicado, inseguro o incompatible.

El rol de la tabla es orientativo. La condición real siempre es permiso + scope resuelto
por PostgreSQL; no debe traducirse a un guard hardcoded.

## Público, sesión y contenido comercial

| Ruta o pantalla | Acción UI | Datos actuales | Endpoint real | Método | Autenticación | Permiso | Scope | Estado | Adaptación necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | Ver landing/FAQ/proceso | Constantes | — | — | No | — | public | `KEEP_STATIC` | Validación editorial |
| `/nosotros` | Ver contenido | Constantes | — | — | No | — | public | `KEEP_STATIC` | Ninguna |
| `/portafolio` | Ver casos | Casos y cifras hardcoded | — | — | No | — | public | `KEEP_STATIC` | Validar claims |
| `/planes` | Ver planes | Precios/features hardcoded | — | — | No | — | public | `KEEP_STATIC` | Retirar promesa SLA |
| `/servicios` | Listar catálogo | API real | `/api/v1/services` | GET | No | — | public | `IMPLEMENTED_7_2` | Paginación, categoría, loading, empty, error y retry |
| `/servicios/:serviceId` | Detalle público | API real | `/api/v1/services/:serviceId` | GET | No | — | public | `IMPLEMENTED_7_2` | Descripción segura, 404 neutral y CTA |
| `/contacto`, `/diagnostico`, `/cotizacion` | Enviar lead | API real | `/api/v1/leads` | POST | No | — | public | `IMPLEMENTED_7_2` | UUID opcional, source tipado, pending, errores y 429 |
| `/login` | Iniciar sesión por email + contraseña o código | Clerk `SignIn` | Clerk | SDK | Clerk | — | — | `IMPLEMENTED_7_3` | Modo restringido, sin signup ni OAuth |
| `/login/*` | Recuperación/verificación aprobada | Clerk `SignIn` | Clerk | SDK | Clerk | — | — | `IMPLEMENTED_7_3` | Flujo prebuilt; subrutas de registro devuelven 404 neutral |
| `/invitacion/aceptar` | Aceptar invitación oficial | `__clerk_ticket` | Clerk | SDK ticket | Clerk | — | — | `IMPLEMENTED_7_3` | Credenciales únicamente; roles/org/status pertenecen a PostgreSQL |
| `/signup`, `/sign-up`, `/registro`, `/register` | Registro público | No existe | — | — | — | — | — | `REMOVED_7_3` | 404 neutral; acceso cerrado por invitación |
| Providers/layouts | Cargar perfil local | `/me` | `/me` | GET | Bearer Clerk | Perfil local `active` | SQL | `IMPLEMENTED_7_3` | Estados no sincronizado, pendiente e inactivo separados |
| Layouts | Logout | Clerk + QueryClient | Clerk | SDK | Clerk | — | — | `IMPLEMENTED_7_3` | Cancela y limpia cache; cambio de usuario también limpia |

## Operaciones de servicios y leads

| Ruta o pantalla | Acción UI | Datos actuales | Endpoint real | Método | Autenticación | Permiso | Scope | Estado | Adaptación necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/app/administracion` | Listar/buscar/filtrar/paginar servicios | API real | `/api/v1/admin/services` | GET | Bearer | `services.read` | global | `IMPLEMENTED_7_5A` | TanStack Query y paginación remota |
| `/app/administracion` | Ver servicio admin | API real | `/api/v1/admin/services/:serviceId` | GET | Bearer | `services.read` | global | `IMPLEMENTED_7_5A` | Detalle previo a edición |
| `/app/administracion` | Crear servicio | API real | `/api/v1/admin/services` | POST | Bearer | `services.manage` | global, actor interno | `IMPLEMENTED_7_5A` | Formulario, doble submit y 409 |
| `/app/administracion` | Editar/publicar/ocultar/activar | API real | `/api/v1/admin/services/:serviceId` | PATCH | Bearer | `services.manage` | global, actor interno | `IMPLEMENTED_7_5A` | Invalidación de cache interna/pública |
| `/app/prospectos` | Listar/buscar/filtrar | API real | `/api/v1/leads` | GET | Bearer | `leads.read` | global autorizado | `IMPLEMENTED_7_5C` | Paginación, búsqueda, estado y orden remotos |
| `/app/prospectos/:id` | Ver lead e historial | API real | `/api/v1/leads/:leadId` | GET | Bearer | `leads.read` | global autorizado | `IMPLEMENTED_7_5C` | Ruta dedicada y 403/404 neutral |
| `/app/prospectos/:id` | Editar datos comerciales | API real | `/api/v1/leads/:leadId` | PATCH | Bearer | `leads.manage` | global, actor interno | `IMPLEMENTED_7_5C` | No envía estado ni asignación en PATCH |
| `/app/prospectos/:id` | Transicionar estado | API real | `/api/v1/leads/:leadId/transition` | POST | Bearer | `leads.manage` | global, actor interno | `IMPLEMENTED_7_5C` | Solo targets adyacentes y reason contractual |
| `/app/prospectos/:id` | Asignar responsable | Yo/responsable actual | `/api/v1/leads/:leadId/assign` | POST | Bearer | `leads.manage` | global, actor interno | `IMPLEMENTED_7_5C` | Sin catálogo general; desasignación diferida porque no acepta `null` |
| `/app/prospectos/:id` | Convertir | API real | `/api/v1/leads/:leadId/convert` | POST | Bearer | `leads.manage`; también `organizations.manage` si aplica | global | `IMPLEMENTED_7_5C` | Standalone/crear/reusar; 409 conserva contexto |

## Organizaciones y memberships

| Ruta o pantalla | Acción UI | Datos actuales | Endpoint real | Método | Autenticación | Permiso | Scope | Estado | Adaptación necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/app/clientes` | Listar/buscar/filtrar/paginar organizaciones | API real | `/api/v1/organizations` | GET | Bearer | `organizations.read` | global u organization | `IMPLEMENTED_7_5A` | Cliente → organization; scope SQL |
| `/app/clientes` | Crear organización | API real | `/api/v1/organizations` | POST | Bearer | `organizations.manage` | global, actor interno | `IMPLEMENTED_7_5A` | Tax pair; manager diferido |
| `/app/clientes/:id` | Ver organización | API real | `/api/v1/organizations/:organizationId` | GET | Bearer | `organizations.read` | global/organization | `IMPLEMENTED_7_5A` | Nullables y 403/404 neutral |
| `/app/clientes/:id` | Editar organización | API real | `/api/v1/organizations/:organizationId` | PATCH | Bearer | `organizations.manage` | global/organization | `IMPLEMENTED_7_5A` | Campos reales; manager diferido |
| `/app/clientes/:id` | Listar contactos | API real | `/api/v1/organizations/:organizationId/members` | GET | Bearer | `organizations.read` | global/organization | `IMPLEMENTED_7_5A` | Contacto = membership local |
| Acción deshabilitada | Añadir membership | Sin catálogo seguro de candidatos | `/api/v1/organizations/:organizationId/members` | POST | Bearer | `organization_members.manage` | organization | `DEFERRED_USER_CATALOG` | No Clerk, seed ni IDs inventados |
| `/app/clientes/:id` | Cambiar/activar/revocar membership | API real | `/api/v1/organizations/:organizationId/members/:memberId` | PATCH | Bearer | `organization_members.manage` | organization | `IMPLEMENTED_7_5A` | Confirmación de revocación |

## Proyectos, miembros, hitos y entregables

| Ruta o pantalla | Acción UI | Datos actuales | Endpoint real | Método | Autenticación | Permiso | Scope | Estado | Adaptación necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Listas/dashboard/portal | Listar proyectos | API real | `/api/v1/projects` | GET | Bearer | `projects.read` | global/organization/project | `IMPLEMENTED_7_5B` | Paginación, filtros y sin `avance` |
| `/app/proyectos` | Crear proyecto | API real | `/api/v1/projects` | POST | Bearer | `projects.manage` | global/project autorizado | `IMPLEMENTED_7_5B` | Fechas, servicio y líder conocido |
| Detalles interno/portal | Ver proyecto | API real | `/api/v1/projects/:projectId` | GET | Bearer | `projects.read` | global/organization/project | `IMPLEMENTED_7_5B` | Consultas relacionadas y 404 scoped |
| `/app/proyectos/:id` | Editar datos generales | API real | `/api/v1/projects/:projectId` | PATCH | Bearer | `projects.manage` | global/project | `IMPLEMENTED_7_5B` | `expectedUpdatedAt`; no status/lead/org |
| Sin control | Asignar líder | Seed embebido | `/api/v1/projects/:projectId/assign` | POST | Bearer | `projects.manage` | global/project | `FRONTEND_MISSING` | Usuario elegible y concurrencia |
| `/app/proyectos/:id` | Transicionar estado | API real | `/api/v1/projects/:projectId/transition` | POST | Bearer | `projects.manage` | global/project | `IMPLEMENTED_7_5B` | State machine, reason y gates |
| Detalle interno | Listar miembros | API real | `/api/v1/projects/:projectId/members` | GET | Bearer | `projects.read` | global/project | `IMPLEMENTED_7_5B` | Recurso separado y estados |
| Sin pantalla | Añadir miembro | No existe | `/api/v1/projects/:projectId/members` | POST | Bearer | `projects.manage` | global/project | `FRONTEND_MISSING` | Roles project_* |
| `/app/proyectos/:id` | Cambiar rol | API real | `/api/v1/projects/:projectId/members/:memberId` | PATCH | Bearer | `projects.manage` | global/project | `IMPLEMENTED_7_5B` | `expectedUpdatedAt` |
| `/app/proyectos/:id` | Revocar miembro | API real | `/api/v1/projects/:projectId/members/:memberId/revoke` | POST | Bearer | `projects.manage` | global/project | `IMPLEMENTED_7_5B` | Confirmación y concurrencia |
| Detalles interno/portal | Listar hitos | API real | `/api/v1/projects/:projectId/milestones` | GET | Bearer | `projects.read` | global/organization/project | `IMPLEMENTED_7_5B` | Loading independiente |
| `/app/proyectos/:id` | Crear hito | API real | `/api/v1/projects/:projectId/milestones` | POST | Bearer | `projects.manage` | global/project | `IMPLEMENTED_7_5B` | Valida rango de fechas |
| `/app/proyectos/:id` | Ver hito | API real | `/api/v1/projects/:projectId/milestones/:milestoneId` | GET | Bearer | `projects.read` | global/organization/project | `IMPLEMENTED_7_5B` | Formulario contextual |
| `/app/proyectos/:id` | Editar/estado hito | API real | `/api/v1/projects/:projectId/milestones/:milestoneId` | PATCH | Bearer | `projects.manage` | global/project | `IMPLEMENTED_7_5B` | Estado y `expectedUpdatedAt` |
| Detalles/dashboard/portal | Listar entregables | API real | `/api/v1/projects/:projectId/deliverables` | GET | Bearer | `projects.read` | global/organization/project | `IMPLEMENTED_7_5B` | Status multivalor, no booleano |
| `/app/proyectos/:id` | Crear entregable | API real | `/api/v1/projects/:projectId/deliverables` | POST | Bearer | `projects.manage` | global/project | `IMPLEMENTED_7_5B` | Milestone opcional |
| `/app/proyectos/:id` | Ver entregable | API real | `/api/v1/projects/:projectId/deliverables/:deliverableId` | GET | Bearer | `projects.read` | global/organization/project | `IMPLEMENTED_7_5B` | Formulario contextual |
| `/app/proyectos/:id` | Editar/aprobar entregable | API real | `/api/v1/projects/:projectId/deliverables/:deliverableId` | PATCH | Bearer | `projects.manage` | global/project | `IMPLEMENTED_7_5B` | Status, actor de aprobación y concurrencia |

## Tareas

| Ruta o pantalla | Acción UI | Datos actuales | Endpoint real | Método | Autenticación | Permiso | Scope | Estado | Adaptación necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/app/tareas`, proyecto | Listar tareas | API real | `/api/v1/tasks` | GET | Bearer | `tasks.read` | global/project | `IMPLEMENTED_7_5B` | Paginación, filtros, estados y minutos |
| `/app/tareas` | Crear tarea | API real | `/api/v1/tasks` | POST | Bearer | `tasks.manage` | global para standalone; project para asociada | `IMPLEMENTED_7_5B` | Sin ticket; descripción obligatoria |
| `/app/tareas` | Ver tarea | API real | `/api/v1/tasks/:taskId` | GET | Bearer | `tasks.read` | global/project | `IMPLEMENTED_7_5B` | Diálogo contextual |
| `/app/tareas` | Editar tarea | API real | `/api/v1/tasks/:taskId` | PATCH | Bearer | `tasks.manage` | global/project | `IMPLEMENTED_7_5B` | `expectedUpdatedAt` |
| `/app/tareas` | Asignar | Usuarios conocidos | `/api/v1/tasks/:taskId/assign` | POST | Bearer | `tasks.manage` | global/project | `IMPLEMENTED_7_5B` | Elegibilidad y concurrencia; desasignación diferida |
| `/app/tareas` | Transicionar estado | API real | `/api/v1/tasks/:taskId/transition` | POST | Bearer | `tasks.manage` | global/project | `IMPLEMENTED_7_5B` | State machine, rol, assignee y reason |
| Portal | Ver tareas de cliente | Filtro posible en seed, sin ruta | — utilizable por roles cliente actuales | — | — | — | — | `HIDE_TEMPORARILY` | RBAC no concede tareas a client roles |
| Cualquier pantalla | Crear tarea desde ticket | `ticketId` mock | — | — | — | — | — | `REMOVE` | Backend no soporta relación directa |

## Tickets y comentarios

| Ruta o pantalla | Acción UI | Datos actuales | Endpoint real | Método | Autenticación | Permiso | Scope | Estado | Adaptación necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/app/tickets` | Listar/buscar/filtrar | API real | `/api/v1/tickets` | GET | Bearer | `tickets.read` | global/organization/project/own | `IMPLEMENTED_7_5C` | Paginación y filtros remotos |
| Portal | Crear ticket | API real | `/api/v1/tickets` | POST | Bearer | `tickets.create` | organization/project/own | `IMPLEMENTED_7_4` | No envía requester ni prioridad operativa |
| Detalles interno/portal | Ver ticket | API real | `/api/v1/tickets/:ticketId` | GET | Bearer | `tickets.read` | global/organization/project/own | `IMPLEMENTED_7_5C` | Interno migrado en 7.5C; portal ya migrado en 7.4 |
| `/app/tickets/:id` | Editar subject/description/requested priority | API real | `/api/v1/tickets/:ticketId` | PATCH | Bearer | `tickets.update` | global/organization/project/own | `IMPLEMENTED_7_5C` | `expectedUpdatedAt` y conservación tras 409 |
| `/app/tickets/:id` | Asignar/desasignar | Usuarios contextuales | `/api/v1/tickets/:ticketId/assign` | POST | Bearer | `tickets.assign` | global/project | `IMPLEMENTED_7_5C` | Yo, actual, líder/miembros; `updatedAt` |
| `/app/tickets/:id` | Cambiar prioridad operativa | API real | `/api/v1/tickets/:ticketId/priority` | POST | Bearer | `tickets.change_priority` | global/project | `IMPLEMENTED_7_5C` | Separada de prioridad solicitada |
| `/app/tickets/:id` | Transicionar/resolver/cerrar | API real | `/api/v1/tickets/:ticketId/transition` | POST | Bearer | `tickets.change_status`, `tickets.resolve` o `tickets.close` | global/project | `IMPLEMENTED_7_5C` | Solo targets por permiso, resolution/reason y concurrencia |
| Portal detalle | Confirmar solución | API real | `/api/v1/tickets/:ticketId/confirm` | POST | Bearer | `tickets.confirm_resolution` | own/organization autorizado | `IMPLEMENTED_7_4` | `decision=confirm` y `updatedAt` |
| Portal detalle | Rechazar solución | API real | `/api/v1/tickets/:ticketId/confirm` | POST | Bearer | `tickets.reject_resolution` | own/organization autorizado | `IMPLEMENTED_7_4` | `decision=reject`, reason obligatorio |
| Portal detalle | Reabrir cerrado | API real | `/api/v1/tickets/:ticketId/reopen` | POST | Bearer | `tickets.request_reopen` | own/organization autorizado | `IMPLEMENTED_7_4` | Reason obligatorio; solo closed |
| Detalles | Listar comentarios | API real | `/api/v1/tickets/:ticketId/comments` | GET | Bearer | `tickets.read`; internos según `ticket_comments.read_internal` | hereda ticket | `IMPLEMENTED_7_5C` | Backend filtra portal; defensa dual impide consulta desde portal interno |
| Detalles | Comentar | API real | `/api/v1/tickets/:ticketId/comments` | POST | Bearer | `ticket_comments.create_client` o `.create_internal` | hereda ticket | `IMPLEMENTED_7_5C` | Visibilidad explícita por capacidad; texto plano |

## Funciones sin endpoint o sin pantalla

| Pantalla/capacidad | Acción | Endpoint | Estado | Tratamiento |
| --- | --- | --- | --- | --- |
| `/portal/documentos` | Listar/descargar/subir archivos | No existe | `HIDE_TEMPORARILY` | Quitar navegación y ruta durante Fase 7 |
| Campana interna | Notificaciones | No existe | `HIDE_TEMPORARILY` | Ocultar; no derivar notificaciones en cliente |
| `/app/auditoria` | Consultar auditoría | No existe | `HIDE_TEMPORARILY` | El permiso `audit.read` no implica endpoint |
| `/app/administracion` | Usuarios/roles/permisos | No existe CRUD funcional | `HIDE_TEMPORARILY` | Retirar matriz hardcoded |
| Dashboard | Métricas empresariales definitivas | No existe | `HIDE_TEMPORARILY` | Solo resúmenes claramente derivados, no KPIs definitivos |
| Portal | Perfil editable | No existe endpoint local | `BACKEND_MISSING` | Clerk puede mostrar perfil de identidad; no simular negocio |
| Público | Políticas/privacidad/términos | No existe pantalla | `FRONTEND_MISSING` | Contenido estático, necesario antes de producción |
| Interno | SLA/facturación/chat/invitaciones | No existe | `HIDE_TEMPORARILY` | Fuera de Fase 7 |

## Brechas prioritarias

1. La UI existente cubre lecturas básicas, pero la mayoría de las 55 operaciones carece de
   pantalla de intención.
2. El portal ya tiene forma para tickets, pero debe reemplazar tenant/requester locales por
   contexto server-owned.
3. Las pantallas de proyecto requieren 4–5 consultas; se necesita estrategia de cache,
   invalidación y errores parciales.
4. Los Kanban actuales no pueden enviar estados arbitrarios. Deben usar la state machine
   real y revertir visualmente ante 409.
5. Administración mezcla servicios listos con usuarios/RBAC no disponibles; debe separarse.

## Estado aplicado en Fase 7.1

La matriz anterior sigue gobernando la migración funcional. Fase 7.1 solo
cambió las filas de fundaciones:

| Fundación | Estado 7.1 | Evidencia |
| --- | --- | --- |
| Clerk + `/me` | `IMPLEMENTED` | token fresco, Bearer, perfil completo y estados de acceso |
| Cliente HTTP | `IMPLEMENTED` | fetch tipado, envelopes, timeout, abort y request ID |
| Cache remota | `IMPLEMENTED` | QueryClient central, retry acotado y limpieza por sesión |
| Guards y permisos | `IMPLEMENTED` | ProtectedRoute y PermissionGate fail closed |
| CORS/origen | `IMPLEMENTED` | `127.0.0.1`, pruebas positivas/negativas/preflight |
| Funciones sin endpoint | `HIDDEN` | rutas/nav retiradas y 404 neutral |
| Módulos funcionales | `NOT_STARTED` | permanecen para Fase 7.2+ según esta matriz |

El estado `IMPLEMENTED` no convierte ningún módulo de negocio a datos reales ni
autoriza avanzar automáticamente a Fase 7.2.

## Evidencia de cierre autenticado 7.1

La fila Clerk + `/me` quedó validada con una sesión real: perfil `pending` →
403, perfil temporalmente activo → 200 y logout → 401. Una reautenticación
produjo otra llamada `/me` 200. La identidad se resolvió por `clerk_user_id` y
los grants provinieron de PostgreSQL.

Los guards conservaron `/portal/tickets`, eligieron `/app` para una identidad
con capacidad interna y cliente, bloquearon el deep link tras logout y
mostraron una salida 404 neutral para `/app/auditoria`. La navegación mantuvo
ocultos Documentos, Notificaciones, Auditoría y RBAC.

En el cierre histórico de 7.1, la prueba no cambió el estado de ningún módulo
funcional de esta matriz. El fixture temporal se retiró totalmente y Fase 7.2
permanecía `NOT_STARTED` antes de su autorización posterior.

## Estado aplicado en Fase 7.2

El catálogo, detalle público y los tres formularios dejaron de usar mocks como
autoridad. Las peticiones públicas no solicitan token Clerk. El POST no se
reintenta automáticamente y omite todos los campos internos.

El smoke creó un servicio publicado y 21 leads sintéticos `PHASE72_SMOKE_*`,
incluyendo la validación controlada de rate limit. Confirmó los tres sources,
el mismo UUID real, cero organizaciones/proyectos nuevos y limpieza final con
0 servicios y 0 leads residuales.

Los módulos internos, portal, administración, organizaciones, proyectos,
tareas, tickets y comentarios no cambiaron.

## Estado aplicado en Fase 7.3

Clerk quedó en modo restringido en la instancia de desarrollo Hobby. El login
efectivo muestra únicamente email/contraseña, el código por email permanece
habilitado y no existen conexiones sociales ni SSO configuradas. No se usaron
allowlist, producción ni capacidades Pro.

El frontend no expone registro público y solo acepta altas por
`/invitacion/aceptar?__clerk_ticket=...`. La pantalla no solicita ni envía roles,
organizaciones, status, permisos o metadata. `/me` distingue consistencia
eventual, acceso pendiente e inactividad; el retry automático se limita al
perfil todavía no sincronizado.

El webhook existente continúa siendo el único puente de identidad y fue
validado para firma, idempotencia, concurrencia, orden y tombstone. La autoridad
de acceso permanece en PostgreSQL. Fase 7.4 permanece `NOT_STARTED`.

## Estado aplicado en Fase 7.4

| Superficie | Contrato | Estado 7.4 | Evidencia |
| --- | --- | --- | --- |
| Contexto portal | `GET /me` | `IMPLEMENTED` | 0/1/múltiples, cambio y limpieza de cache |
| Nombre organización | `GET /organizations/:id` | `IMPLEMENTED_WITH_FALLBACK` | nombre real o etiqueta neutra si no hay lectura |
| Proyectos | `GET /projects`, `GET /projects/:id` | `IMPLEMENTED` | filtros/paginación servidor, 404 neutral, cross-tenant |
| Hitos | `GET /projects/:id/milestones` | `IMPLEMENTED` | consulta separada, vacío/error parcial/retry |
| Entregables | `GET /projects/:id/deliverables` | `IMPLEMENTED` | consulta separada, estado real, sin avance ficticio |
| Tickets | `GET|POST /tickets`, `GET /tickets/:id` | `IMPLEMENTED` | standalone/org/proyecto, `requestedPriority`, sin requester |
| Comentarios cliente | `GET|POST /tickets/:id/comments` | `IMPLEMENTED_FAIL_CLOSED` | POST client, actor no interno sin internos, dual no consulta desde portal |
| Confirmar/rechazar | `POST /tickets/:id/confirm` | `IMPLEMENTED` | permiso+estado, motivo, `expectedUpdatedAt`, 409 |
| Reabrir | `POST /tickets/:id/reopen` | `IMPLEMENTED` | closed, motivo, `expectedUpdatedAt`, 409 |
| Funciones sin contrato de fase | ninguno | `HIDDEN` | archivos, tareas, notificaciones, auditoría, RBAC, SLA, billing, chat, métricas |

El portal no usa `AppStore`, seeds ni filtros locales de tenant. Standalone se
activa únicamente cuando `/me` devuelve cero organizaciones, pues el contrato
de listado no ofrece un filtro nullable. La autorización continúa en IlvoxB y
PostgreSQL; `PermissionGate` no se considera barrera de seguridad.

## Estado aplicado en Fase 7.5B

| Superficie interna | Contratos | Estado 7.5B | Evidencia |
| --- | --- | --- | --- |
| Proyectos | `GET/POST /projects`, `GET/PATCH /projects/:id`, `POST /transition` | `IMPLEMENTED` | búsqueda/filtros/orden/paginación, CRUD, estados adyacentes, 404 neutral y 409 preservado |
| Miembros existentes | `GET /members`, `PATCH /members/:userId`, `POST /revoke` | `IMPLEMENTED_WITH_DEFERRED_ADD` | rol/estado real, edición y confirmación; alta diferida sin catálogo seguro |
| Hitos | `GET/POST /milestones`, `GET/PATCH /milestones/:id` | `IMPLEMENTED` | fechas dentro del proyecto, concurrencia, error/retry independiente |
| Entregables | `GET/POST /deliverables`, `GET/PATCH /deliverables/:id` | `IMPLEMENTED` | hito scoped opcional, estados multivalor, aprobación/rechazo real |
| Tareas standalone | `GET/POST /tasks`, `GET/PATCH /tasks/:id`, assign/transition | `IMPLEMENTED` | sin `projectId`, usuario autenticado conocido, minutos y concurrencia |
| Tareas de proyecto | mismos contratos de tareas con `projectId` real | `IMPLEMENTED` | lista embebida en detalle, scope cruzado neutral y fechas de proyecto |
| Asignación general/desasignación | `POST /tasks/:id/assign` exige UUID | `DEFERRED_BY_CONTRACT` | solo usuario autenticado/líder conocido; no existe catálogo ni null |
| Mocks | ninguno en pantallas 7.5B | `REMOVED_FROM_SCOPE` | sin `AppStore`, seed o Clerk browser users |

El smoke `PHASE75B_SMOKE_` validó permisos read/manage, 403/404 cross-tenant, aislamiento
entre proyectos, asociación hito-entregable, asignación, transiciones, 409 y
`residualFixtures: 0`. No se modificaron tablas, migraciones, OpenAPI o RBAC. Prospectos,
Tickets internos y Personal permanecen fuera de este cierre.
