# Auditoría técnica inicial de ILVOX

Fecha de corte: 2026-07-22  
Alcance: prototipo frontend `IlvoxF`, script `ilvox_complete_reconstructed.sql` y repositorio backend `IlvoxB`.  
Estado del entregable: auditoría y plan; sin implementación y sin modificaciones al frontend o al SQL.

## Evidencia revisada y límites de la validación

- Frontend: 118 archivos fuera de `node_modules`, con revisión de configuración, router, layouts, páginas, tipos, enums, store, autenticación, mocks, formularios y documento funcional incluido en `src/imports/pasted_text/tech-platform-doc.md`.
- SQL: 1.176 líneas, 19 tablas, 53 índices, 43 referencias foráneas, 55 restricciones `CHECK`, 11 roles, 23 permisos y 142 asociaciones rol-permiso.
- Backend: el repositorio solo contenía `README.md`, `LICENSE` y archivos de Git; no existe todavía una aplicación ejecutable.
- Se ejecutó `tsc --noEmit` sobre el frontend. Falló por falta de los tipos de `import.meta.env` y de la declaración para importar PNG. No se modificó el frontend.
- No hay `psql`, Docker ni una instancia PostgreSQL suministrada en este entorno. La validación SQL de esta fase es estática; la ejecución real del script en PostgreSQL 16 limpio queda como criterio obligatorio de la fase de implementación.
- Los textos públicos de marketing se clasifican como contenido visual mientras no se confirme que deban administrarse desde el backend.

## 1. Resumen ejecutivo

El frontend es un prototipo React/Vite completo y navegable de tres áreas: sitio público, plataforma interna y portal del cliente. Toda la información operativa se carga desde un único archivo semilla y todas las mutaciones ocurren en memoria; al recargar se pierden. Clerk está integrado solo en la capa visual: si hay una publishable key muestra el componente de acceso, pero luego vincula la identidad a los usuarios mock mediante `publicMetadata.appUserId` o, como respaldo inseguro, por correo. La autorización real se reduce a distinguir `interno` de `cliente` en el navegador.

El SQL constituye una base sólida para el núcleo del MVP. Modela identidad local, RBAC de tres alcances, organizaciones, membresías, catálogo de servicios, prospectos, proyectos, miembros, hitos, entregables, tickets, comentarios, tareas, archivos y auditoría. El orden de creación es coherente, no se observan ciclos de creación y la multitenencia se refuerza en varias relaciones mediante claves compuestas `(id, organization_id)`.

La viabilidad del backend con Node.js, TypeScript, Fastify, Drizzle ORM, PostgreSQL y Clerk es alta, pero todavía no puede calificarse como “completamente funcional”. Hay brechas de esquema para notificaciones —obligatorias según el documento funcional y visibles en la UI—, invitaciones/preautorización, comentarios y tiempo de tareas, actividades comerciales y capacidades de SLA. También faltan decisiones sobre almacenamiento de archivos, cálculo de avance y transiciones de estado.

No debe iniciarse una implementación masiva sobre el esquema actual. Primero deben aprobarse las brechas críticas y altas, en especial la matriz RBAC de 142 asignaciones, la autorización de contactos de cliente, el flujo de invitación y las migraciones mínimas del MVP.

## 2. Tecnologías detectadas

| Área | Tecnología detectada | Observación |
| --- | --- | --- |
| Framework | React 18 + Vite 6 | SPA, sin SSR. |
| Lenguaje | TypeScript estricto | `tsconfig.check.json` usa `strict`, pero el chequeo actual falla por tipos de Vite/activos. |
| Router | `react-router` 7 | 26 rutas: 9 públicas, 11 internas y 6 de portal. |
| UI | Radix UI, componentes shadcn, MUI, Tailwind 4 | MUI figura en dependencias, aunque las pantallas auditadas usan principalmente shadcn/Radix. |
| Gráficas | Recharts | Métricas calculadas en el navegador sobre arreglos completos. |
| Formularios | Estado local de React | No hay validación de contrato compartida ni cliente HTTP. |
| Estado | Context + `useState` | `AppStore.tsx` concentra lecturas, mutaciones, auditoría y notificaciones mock. |
| Datos | `src/app/mock/seed.ts` | Fuente única de todos los datos operativos simulados. |
| Autenticación | `@clerk/clerk-react` | Login real opcional; perfil y autorización continúan siendo mock. |
| Pruebas | No detectadas | No hay suite unitaria, integración ni E2E. |
| API/backend | No detectado | No existen fetchers, repositorios, endpoints ni persistencia. |

Problemas técnicos actuales del frontend que no se corrigen en esta fase:

- `src/app/auth/clerk.ts:20`: TypeScript no conoce `ImportMeta.env` porque no se incluyen los tipos de Vite.
- `src/app/components/shared/Logo.tsx:1`: TypeScript no tiene declaración para el módulo PNG.
- El filtrado, conteo, búsqueda, ordenamiento y aislamiento por organización se realizan sobre arreglos completos en el navegador; no escalarán y no constituyen controles de seguridad.
- El documento de plan todavía menciona una futura migración a Supabase, lo cual contradice la decisión vigente PostgreSQL + Clerk y debe actualizarse cuando comience la implementación.

## 3. Módulos detectados

### Sitio público

- Inicio: selector de necesidad, escenarios de servicio, proceso, casos, compromisos, vista previa del portal y FAQ.
- Servicios: cinco categorías y lista de capacidades.
- Nosotros: misión, visión y valores.
- Portafolio: tres casos de éxito simulados.
- Planes: tres modalidades y precios simulados.
- Contacto, diagnóstico y cotización: variantes del mismo formulario de captación.
- Login: Clerk cuando hay configuración; selector de cuentas demo en caso contrario.

### Plataforma interna

- Dashboard: prospectos activos, clientes, proyectos activos, tickets abiertos, tareas vencidas, gráficas y vencimientos.
- Prospectos: tablero Kanban, lista, cambio de estado y conversión en cliente.
- Clientes: búsqueda, lista, responsable, conteos y detalle con proyectos, tickets y contactos.
- Proyectos: lista, avance, equipo, fechas, hitos, entregables y tareas.
- Tareas: creación, asignación y tablero Kanban con cambio de estado.
- Tickets: lista filtrable, detalle, comentarios internos/cliente, cambio de estado y resolución.
- Administración: consulta de usuarios, matriz de roles simulada y servicios.
- Auditoría: línea de tiempo de acciones.
- Notificaciones: bandeja en el layout y marcado como leído.

### Portal del cliente

- Dashboard por organización.
- Mis proyectos y detalle con avance, hitos y entregables.
- Mis tickets: crear, listar, consultar, comentar y confirmar solución.
- Documentos: lista derivada de entregables; el botón de descarga no tiene comportamiento.

### Capacidades declaradas en el documento funcional pero no representadas completamente

- Notas y actividades comerciales, propuestas y conversaciones de prospectos.
- Creación/edición de clientes y proyectos desde la UI.
- Comentarios, archivos, subtareas, dependencias y registro de tiempo en tareas.
- Asignación de ticket a equipo, categorías, servicio contratado, primera respuesta y SLA.
- Rechazo explícito de una solución por el cliente.
- Aprobación interactiva de entregables.
- Filtros avanzados, paginación y exportación CSV/PDF.
- Gestión de prioridades, estados, acuerdos de servicio, plantillas, integraciones y parámetros.
- Invitaciones, perfil editable y preferencias de notificación.
- Blog o recursos.

## 4. Inventario de datos ficticios

### Datos operativos centrales

| Archivo y ubicación | Variable/función | Información | Consumidores principales | Destino PostgreSQL / endpoint | Naturaleza |
| --- | --- | --- | --- | --- | --- |
| `src/app/mock/seed.ts:38` | `usuarios` | 6 internos y 3 contactos, roles, datos personales y último acceso | login, layouts, administración, clientes, proyectos, tareas, tickets, auditoría | `app_users`, `user_roles`, `organization_memberships`, `project_members`; `GET /api/v1/me`, `/users` | Persistente |
| `src/app/mock/seed.ts:52` | `clientes` | 4 empresas, NIT, sector, tamaño, estado y responsable | clientes, proyectos, tickets, portal | `organizations`; `GET /api/v1/organizations` | Persistente |
| `src/app/mock/seed.ts:60` | `prospectos` | 5 oportunidades en estados distintos | dashboard, prospectos | `leads`; `GET/POST /api/v1/leads` | Persistente |
| `src/app/mock/seed.ts:69` | `servicios` | 5 servicios del catálogo | administración, prospectos | `services`; `GET /api/v1/public/services` y `/services` | Persistente |
| `src/app/mock/seed.ts:78` | `proyectos` | 4 proyectos con avance, equipo, hitos y entregables anidados | dashboard, clientes, proyectos, portal, documentos | `projects`, `project_members`, `project_milestones`, `deliverables`; `/projects` | Persistente y derivado (`avance`) |
| `src/app/mock/seed.ts:131` | `tareas` | 8 tareas, estimación y tiempo utilizado | dashboard, proyectos, tareas | `tasks`; `/tasks` | Persistente; `tiempoUtilizado` no tiene soporte SQL |
| `src/app/mock/seed.ts:143` | `tickets` | 4 tickets, estados, resolución y comentarios | dashboard, clientes, tickets, portal | `tickets`, `ticket_comments`; `/tickets` | Persistente |
| `src/app/mock/seed.ts:186` | `notificaciones` | 3 notificaciones y estado de lectura | layout interno | Sin tabla; `/me/notifications` requiere migración | Persistente, brecha |
| `src/app/mock/seed.ts:193` | `auditoria` | 3 acciones históricas | auditoría | `audit_events`; `/audit-events` | Persistente |
| `src/app/mock/seed.ts:204` | `createSeedState` | Copia profunda del estado inicial | `AppStoreProvider` | Sustituir por consultas específicas, nunca por una descarga global | Infraestructura mock |
| `src/app/mock/seed.ts:215` | `cuentasDemo` | IDs de cuentas seleccionables | login demo | No migrar; Clerk gestiona el acceso | Exclusivamente demo |

### Mutaciones y reglas simuladas

| Archivo | Operación mock | Endpoint futuro | Observación |
| --- | --- | --- | --- |
| `src/app/store/AppStore.tsx:104` | login local | Clerk + `GET /api/v1/me` | No debe existir un login propio del backend. |
| `src/app/store/AppStore.tsx:111` | crear prospecto | `POST /api/v1/public/leads` | Usa IDs incrementales en memoria y notifica al usuario fijo `u1`. |
| `src/app/store/AppStore.tsx:123` | cambiar estado de prospecto | `PATCH /api/v1/leads/:id/status` | No valida transiciones ni permisos. |
| `src/app/store/AppStore.tsx:132` | convertir prospecto | `POST /api/v1/leads/:id/convert` | Crea empresa con valores “Por definir”; debe ser transaccional. |
| `src/app/store/AppStore.tsx:157` | crear tarea | `POST /api/v1/tasks` | Debe validar contexto, responsable y organización. |
| `src/app/store/AppStore.tsx:164` | cambiar estado de tarea | `PATCH /api/v1/tasks/:id/status` | No valida que el actor esté autorizado. |
| `src/app/store/AppStore.tsx:173` | crear ticket | `POST /api/v1/tickets` | Código y año están escritos en frontend; el SQL ya los genera. Asigna siempre a `u4`. |
| `src/app/store/AppStore.tsx:197` | comentar ticket | `POST /api/v1/tickets/:id/comments` | No audita y confía en autor/visibilidad del cliente. |
| `src/app/store/AppStore.tsx:208` | cambiar estado de ticket | `POST /api/v1/tickets/:id/transitions` | Permite cualquier salto de estado y puede violar los `CHECK` SQL. |
| `src/app/store/AppStore.tsx:225` | resolver ticket | `POST /api/v1/tickets/:id/resolve` | La regla de resolución existe, pero solo en UI/store. |
| `src/app/store/AppStore.tsx:239` | marcar notificación leída | `PATCH /api/v1/me/notifications/:id/read` | Requiere tabla nueva. |

### Contenido estático y visual

| Archivo | Variables | Clasificación | Recomendación |
| --- | --- | --- | --- |
| `src/app/pages/public/Home.tsx:35-161` | `needs`, `heroDefault`, `escenarios`, `proceso`, `casos`, `compromisos`, `faqs` | Contenido editorial y demostración visual | Mantener estático en el MVP; si se exige administración, hace falta un modelo CMS no presente. |
| `src/app/components/public/HeroShowcase.tsx:21` | `flujo` | Animación ilustrativa | Exclusivamente visual; no crear endpoint. |
| `src/app/pages/public/Servicios.tsx:7` | `detalle` | Detalle editorial por categoría | Puede seguir en frontend; `services` solo cubre catálogo resumido. |
| `src/app/pages/public/Planes.tsx:7` | `planes` | Precios y modalidades | No hay tablas de planes, contratos o facturación. No publicar como dato real sin decisión comercial. |
| `src/app/pages/public/Portafolio.tsx:6` | `casos` | Casos de éxito y resultados | No hay esquema de portafolio/CMS. Algunos nombres coinciden con clientes mock. |
| `src/app/pages/public/Contacto.tsx:19` | correo, teléfono, ubicación | Configuración pública | Puede ser configuración de despliegue; no existe tabla de ajustes. |
| `src/app/pages/internal/Administracion.tsx:19-32` | `permisos`, `matrizRoles` | RBAC simulado | Debe eliminarse al integrar y obtenerse de `roles`, `permissions`, `role_permissions`. |
| `src/app/data/enums.ts` | etiquetas, tonos y columnas Kanban | Presentación | Conservar en frontend, pero mapear códigos API en inglés de forma explícita. |

## 5. Mapa del esquema PostgreSQL

### Entidades y relaciones

| Dominio | Tabla | Responsabilidad y relaciones principales |
| --- | --- | --- |
| Identidad | `app_users` | Perfil local unido por `clerk_user_id` único; no almacena contraseñas ni sesiones. |
| RBAC | `roles`, `permissions`, `role_permissions` | Roles globales, de organización y de proyecto; permisos por código. |
| RBAC | `user_roles` | Solo roles globales; `role_scope` está fijado a `global`. |
| Clerk | `identity_webhook_events` | Idempotencia y estado de procesamiento de eventos Clerk. |
| Clientes | `organizations` | Empresa, estado, NIT normalizado y responsable interno. |
| Clientes | `organization_memberships` | Contactos por organización, rol y ciclo pending/active/revoked. |
| Catálogo | `services` | Servicios con categoría, visibilidad y actividad. |
| Comercial | `leads` | Prospecto, origen, estado, asignación y conversión a organización. |
| Proyectos | `projects` | Organización, servicio, responsable, creador, fechas, estado y prioridad. |
| Proyectos | `project_members` | Usuarios y roles de alcance proyecto. |
| Proyectos | `project_milestones` | Hitos con fecha, estado y finalización consistente. |
| Proyectos | `deliverables` | Entregables con flujo de revisión/aprobación. |
| Soporte | `tickets` | Organización, proyecto opcional, solicitante, responsable, código generado, prioridades, estado y resolución. |
| Soporte | `ticket_comments` | Comentarios internos o visibles al cliente. |
| Trabajo | `tasks` | Tareas autónomas internas o asociadas exclusivamente a proyecto/ticket. |
| Archivos | `files` | Metadatos de almacenamiento y un único padre: proyecto, ticket, comentario, tarea o entregable. |
| Auditoría | `audit_events` | Actor, organización, acción, entidad, valores anterior/nuevo, IP, agente y request ID. |

### Integridad que sí aporta el SQL

- UUID con `pgcrypto`, claves primarias explícitas y referencias `ON DELETE RESTRICT` para casi todos los datos de negocio.
- Consistencia organizacional en proyectos y sus hijos mediante claves compuestas.
- Conversión de prospecto consistente: un lead convertido exige organización y fecha; los demás estados prohíben esos campos.
- Código de ticket generado e inmutable a partir de identidad global y año de creación.
- Resolución obligatoria para estados `resolved` y `closed`, y fecha de cierre obligatoria solo para `closed`.
- Comentarios con visibilidad `internal|client`.
- Una tarea no puede apuntar simultáneamente a proyecto y ticket.
- Un archivo debe tener exactamente un padre, tamaño positivo, checksum válido cuando existe y estado de análisis.
- Hitos y entregables coordinan estado con sus marcas de finalización/aprobación.
- No se observan dependencias circulares de creación.

### Traducción necesaria entre frontend y SQL

| Concepto frontend | SQL |
| --- | --- |
| `superadministrador`, `administrador`, `lider`, `colaborador`, `soporte` | `super_admin`, `admin`, `project_lead`, `contributor`, `support_agent` |
| contacto cliente | `client_contact` o `client_manager` en `organization_memberships` |
| `pequena`, `mediana`, `grande` | `small`, `medium`, `large` |
| `desarrollo`, `presencia`, `automatizacion`, `soporte` | `development`, `digital_presence`, `automation`, `support` |
| Estados y tipos en español | Códigos ingleses definidos en los `CHECK`; la API debe exponer una convención estable. |
| `clienteId` | `organization_id` |
| `responsableId` | `lead_user_id`, `assigned_to_user_id` o `account_manager_user_id` según dominio. |
| `fechaFin` | `due_date` |
| `tiempoEstimado` en horas | `estimated_minutes` |
| `aprobado` booleano | `deliverables.status = 'approved'` |

## 6. Correspondencia frontend, backend y base de datos

| Módulo/pantalla | Acción | Datos mostrados | Mock actual | Tablas | Regla principal | Endpoint | Rol/permiso |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Público/Servicios | listar | catálogo visible | `detalle`, `servicios` | `services` | solo activos y públicos | `GET /api/v1/public/services` | Público |
| Contacto/Diagnóstico/Cotización | crear | confirmación | estado de formulario | `leads`, `services` | origen controlado por ruta; límites y antispam | `POST /api/v1/public/leads` | Público |
| Login | autenticar | componente Clerk/cuentas demo | `cuentasDemo` | `app_users`, membresías, RBAC | Clerk autentica; DB autoriza y bloquea | Clerk + `GET /api/v1/me` | Autenticado |
| Dashboard interno | consultar métricas | conteos, gráficas, próximos vencimientos | cálculos locales | `leads`, `organizations`, `projects`, `tasks`, `tickets` | filtrar por alcance efectivo | `GET /api/v1/dashboard/internal` | permisos de lectura asociados |
| Prospectos | listar/filtrar | tablero y tabla | `prospectos` | `leads`, `services`, `app_users` | paginación y filtros en servidor | `GET /api/v1/leads` | `leads.read` |
| Prospectos | cambiar estado | columna/estado | mutación local | `leads`, `audit_events` | transición permitida y auditada | `PATCH /api/v1/leads/:id/status` | `leads.manage` |
| Prospectos | convertir | nueva empresa | organización con placeholders | `leads`, `organizations`, `audit_events` | solo aprobado; transacción e idempotencia | `POST /api/v1/leads/:id/convert` | `leads.manage`, `organizations.manage` |
| Clientes | buscar/listar | empresa, NIT, responsable y conteos | filtros locales | `organizations`, usuarios, proyectos, tickets | alcance y paginación en servidor | `GET /api/v1/organizations` | `organizations.read` |
| Cliente detalle | consultar | perfil, contactos, proyectos, tickets | joins locales | `organizations`, membresías, proyectos, tickets | nunca filtrar tenencia solo en frontend | `GET /api/v1/organizations/:id` | `organizations.read` |
| Proyectos | listar | estado, prioridad, avance, equipo | `proyectos` | `projects`, miembros, tareas | avance derivado con regla aprobada | `GET /api/v1/projects` | `projects.read` |
| Proyecto detalle | consultar | fechas, hitos, entregables, equipo, tareas | objetos anidados | tablas de proyectos y `tasks` | alcance global/org/proyecto | `GET /api/v1/projects/:id` | `projects.read` |
| Tareas | listar/tablero | responsable, prioridad, estado, vencimiento | `tareas` | `tasks`, usuarios, proyectos | solo tareas autorizadas; paginación | `GET /api/v1/tasks` | `tasks.read` |
| Tareas | crear | nueva tarjeta | formulario local | `tasks`, `audit_events` | contexto válido y responsable autorizado | `POST /api/v1/tasks` | `tasks.manage` |
| Tareas | cambiar estado | movimiento Kanban | mutación local | `tasks`, `audit_events` | máquina de estados y concurrencia | `PATCH /api/v1/tasks/:id/status` | `tasks.manage` |
| Tickets | listar/filtrar | código, cliente, tipo, responsable, prioridad, estado | filtro local | `tickets`, organizaciones, usuarios | filtros y paginación servidor | `GET /api/v1/tickets` | `tickets.read` |
| Ticket interno | consultar | detalle, resolución, conversación | ticket anidado | `tickets`, `ticket_comments` | internos pueden ver según permiso | `GET /api/v1/tickets/:id` | `tickets.read` + visibilidad |
| Ticket interno | comentar | comentario cliente/interno | mutación local | `ticket_comments`, `audit_events` | autor tomado del token; permiso según visibilidad | `POST /api/v1/tickets/:id/comments` | permiso de comentario correspondiente |
| Ticket interno | resolver/transicionar | estado y solución | selector sin restricciones | `tickets`, `audit_events` | transición válida, resolución obligatoria | `POST /api/v1/tickets/:id/transitions` | `tickets.change_status/resolve/close` |
| Administración/usuarios | listar | perfil, rol, estado | `usuarios` | usuarios y RBAC | solo administración | `GET /api/v1/admin/users` | `users.manage` |
| Administración/RBAC | consultar/asignar | matriz rol-permiso | `matrizRoles` estática | tablas RBAC | roles sembrados; asignaciones auditadas | `GET /api/v1/admin/roles`; `PUT .../role-assignments` | `roles.manage` |
| Administración/servicios | listar/gestionar | servicio y visibilidad | `servicios` | `services` | falta permiso `services.manage` | `/api/v1/admin/services` | nuevo permiso requerido |
| Auditoría | listar/filtrar | actor, acción, entidad, detalle | `auditoria` | `audit_events`, usuarios | no exponer secretos; solo lectura | `GET /api/v1/audit-events` | `audit.read` |
| Notificaciones internas | listar/marcar | bandeja y no leídas | `notificaciones` | sin soporte | propiedad del usuario | `/api/v1/me/notifications` | Migración requerida |
| Portal/Dashboard | consultar | proyectos, tickets, entregables | filtros locales por `clienteId` | organizaciones, proyectos, entregables, tickets | membresía activa y alcance org | `GET /api/v1/dashboard/portal` | rol de organización |
| Portal/Proyectos | listar/detalle | avance, hitos, entregables | filtro local | tablas de proyectos | solo organización/proyectos autorizados | `GET /api/v1/projects[/:id]` | `projects.read` |
| Portal/Tickets | crear | formulario y código | mutación local | `tickets`, `audit_events` | solicitante/organización desde contexto; proyecto propio | `POST /api/v1/tickets` | `tickets.create` |
| Portal/Ticket | comentar | conversación pública | filtro local de comentarios | `ticket_comments` | nunca devolver internos | `POST /api/v1/tickets/:id/comments` | `ticket_comments.create_client` |
| Portal/Ticket | confirmar solución | cierre | cambio local | `tickets`, `audit_events` | solo desde resuelto y con resolución | `POST /api/v1/tickets/:id/confirm-resolution` | permiso a refinar |
| Portal/Documentos | listar/descargar | entregables autorizados | derivados sin archivo real | `deliverables`, `files` | archivo activo, padre autorizado y URL temporal | `GET /api/v1/files`; `POST /files/:id/download-url` | `files.read` |

### Brechas de correspondencia principales

- `Proyecto.avance` no existe como columna. El documento dice calcularlo desde tareas completadas, pero no define ponderación ni tratamiento de tareas canceladas/bloqueadas.
- `Tarea.tiempoUtilizado` no existe; tampoco hay comentarios de tarea ni registro de tiempos.
- `Notificacion` no tiene tabla.
- El frontend usa categoría de servicio para leads, mientras SQL relaciona un `service_id` concreto.
- El frontend maneja una prioridad de ticket; SQL separa `requested_priority` y prioridad efectiva.
- El documento exige categoría y servicio contratado del ticket; SQL no tiene esos campos.
- El documento exige primera respuesta, métricas y pausa de SLA; SQL no los modela.
- El portal muestra entregables como documentos, pero un entregable no garantiza que exista un archivo.
- El frontend muestra `ultimoAcceso`; `app_users` solo tiene `last_synced_at`.
- Estados `inactivo`/`prospecto` del frontend no tienen traducción uno-a-uno con los estados de usuario/organización del SQL.
- Planes, precios, casos de éxito, FAQ y contenido corporativo no tienen modelo persistente.

## 7. Autenticación y autorización

### Flujo propuesto con Clerk

1. Clerk realiza registro, login, MFA/proveedores, sesiones y emisión de token.
2. El plugin oficial de Clerk para Fastify verifica cookies/`Authorization` y expone el `userId` autenticado.
3. Un hook del backend busca exclusivamente `app_users.clerk_user_id = userId`; nunca vincula por correo.
4. Si no existe perfil local o su estado no es `active`, se rechaza el acceso de negocio. Los webhooks pueden crear/sincronizar perfiles `pending`, pero no conceden permisos.
5. El contexto de autorización carga roles globales, membresías activas de organización, roles de proyecto y permisos efectivos.
6. Cada servicio aplica permiso + alcance de recurso. Tener `projects.read` no implica leer todos los proyectos: el alcance global, de organización o proyecto determina las filas permitidas.
7. Los datos de actor, organización y autor nunca se toman del body cuando pueden derivarse del contexto autenticado.

### Webhooks

- Ruta pública dedicada: `POST /api/v1/webhooks/clerk`.
- Verificación de firma sobre el body crudo antes de parsear/usar el evento.
- Idempotencia mediante `identity_webhook_events.clerk_event_id`.
- Eventos mínimos: `user.created`, `user.updated`, `user.deleted`.
- Transacción por evento: registrar/obtener evento, marcar `processing`, sincronizar campos permitidos y terminar en `processed` o `failed` con error redactado.
- `user.deleted` debe marcar el perfil local `deleted`; no borrar relaciones históricas.
- Un webhook es asíncrono y no debe ser el único mecanismo para desbloquear un primer acceso sensible. Hace falta reconciliación explícita y manejo de carreras.

### Mapeo RBAC

| Perfil visual | Rol SQL recomendado | Alcance |
| --- | --- | --- |
| Superadministrador | `super_admin` | global |
| Administrador | `admin` | global |
| Comercial, no visible hoy | `sales` | global |
| Soporte | `support_agent` | global |
| Líder | `project_lead` | global o proyecto según asignación |
| Colaborador | `contributor` o `project_member` | global/proyecto |
| Responsable cliente | `client_manager` | organización |
| Contacto cliente | `client_contact` | organización |
| Observador | `project_viewer` | proyecto |

### Problema de invitaciones

`app_users.clerk_user_id` es obligatorio, por lo que no puede representar una invitación antes de que exista el usuario Clerk. Tampoco hay una tabla local que conserve correo invitado, organización y rol pendiente. Alternativas a decidir antes de implementar RF-011/RF-013:

- agregar una tabla `user_invitations`/`access_grants` local y enlazarla al aceptar; o
- usar invitaciones Clerk y dejar al nuevo usuario `pending` hasta asignación manual posterior, aceptando que no hay preasignación local completa.

La primera alternativa satisface mejor la responsabilidad de PostgreSQL sobre roles y membresías, pero requiere migración aprobada.

Referencias oficiales consultadas para este diseño:

- [Clerk Fastify SDK](https://clerk.com/docs/reference/fastify/overview): plugin de autenticación y obtención del estado autenticado en Fastify.
- [Sincronización de datos con webhooks](https://clerk.com/docs/guides/development/webhooks/syncing): eventos de usuario, ruta pública, firma y reintentos.
- [`verifyWebhook()`](https://clerk.com/docs/reference/backend/verify-webhook): verificación de autenticidad antes de procesar el evento.
- [Descripción general de webhooks](https://clerk.com/docs/guides/development/webhooks/overview): naturaleza asíncrona, reintentos y replay.

## 8. Endpoints requeridos

Convención propuesta: prefijo `/api/v1`, JSON `{ "data": ... }`, metadatos de paginación en `meta`, errores `{ "error": { "code", "message", "details?", "requestId" } }`. Listados usan `page`, `pageSize` limitado, `sort`, `q` y filtros permitidos. Los cambios críticos aceptan `version` o `updatedAt` para control optimista y `Idempotency-Key` donde se creen recursos o se ejecuten conversiones.

### Sistema, identidad y usuario actual

| Método y ruta | Propósito | Auth/permiso | Tablas/efectos |
| --- | --- | --- | --- |
| `GET /health/live` | proceso vivo | pública | sin DB obligatoria |
| `GET /health/ready` | DB y configuración listas | pública, respuesta mínima | prueba PostgreSQL |
| `GET /api/v1/me` | perfil, membresías y permisos efectivos | autenticado/activo | usuarios y RBAC |
| `PATCH /api/v1/me` | perfil de negocio editable | autenticado/activo | `app_users`, auditoría; alcance por definir |
| `POST /api/v1/webhooks/clerk` | sincronización firmada | firma Clerk | webhook events, usuarios |

### Público y comercial

| Método y ruta | Propósito | Auth/permiso | Reglas |
| --- | --- | --- | --- |
| `GET /api/v1/public/services` | catálogo público | pública | `is_public AND is_active` |
| `POST /api/v1/public/leads` | contacto/diagnóstico/cotización | pública | origen permitido, rate limit, normalización y respuesta genérica |
| `GET /api/v1/leads` | lista/Kanban | `leads.read` | paginación, estado, servicio, asignado, fechas |
| `GET /api/v1/leads/:id` | detalle | `leads.read` | incluye servicio y conversión |
| `PATCH /api/v1/leads/:id` | datos/asignación | `leads.manage` | auditar |
| `PATCH /api/v1/leads/:id/status` | transición comercial | `leads.manage` | máquina de estados |
| `POST /api/v1/leads/:id/convert` | convertir en organización | `leads.manage` + `organizations.manage` | transacción, solo approved, idempotente |

### Organizaciones, usuarios y RBAC

| Método y ruta | Propósito | Auth/permiso | Reglas |
| --- | --- | --- | --- |
| `GET /api/v1/organizations` | buscar/listar | `organizations.read` | alcance y conteos agregados |
| `POST /api/v1/organizations` | crear | `organizations.manage` | NIT normalizado por país |
| `GET /api/v1/organizations/:id` | detalle | `organizations.read` | contacto/proyectos/tickets limitados |
| `PATCH /api/v1/organizations/:id` | editar/archivar | `organizations.manage` | auditoría; no borrado físico |
| `GET /api/v1/organizations/:id/members` | contactos | `organizations.read` | membresías activas/pending según permiso |
| `POST /api/v1/organizations/:id/invitations` | invitar contacto | `users.manage`/permiso futuro | bloqueado por decisión de esquema |
| `PATCH /api/v1/organizations/:id/members/:userId` | rol/estado | `roles.manage` | transacción y auditoría |
| `GET /api/v1/admin/users` | usuarios internos | `users.manage` | filtros y paginación |
| `PATCH /api/v1/admin/users/:id/status` | activar/bloquear | `users.manage` | no auto-bloqueo del último superadmin |
| `GET /api/v1/admin/roles` | roles con permisos | `roles.manage` | solo catálogo sembrado |
| `PUT /api/v1/admin/users/:id/roles/:roleId` | asignar rol global | `roles.manage` | `assigned_by`, auditoría |
| `DELETE /api/v1/admin/users/:id/roles/:roleId` | revocar rol global | `roles.manage` | guardas de seguridad |
| `GET /api/v1/admin/services` | catálogo completo | `services.read` | internos |
| `POST/PATCH /api/v1/admin/services[/:id]` | gestionar catálogo | permiso nuevo `services.manage` | requiere migración de seed RBAC |

### Proyectos y tareas

| Método y ruta | Propósito | Auth/permiso | Reglas |
| --- | --- | --- | --- |
| `GET /api/v1/projects` | listar | `projects.read` | alcance global/org/proyecto |
| `POST /api/v1/projects` | crear | `projects.manage` | organización, responsable y fechas válidas |
| `GET /api/v1/projects/:id` | detalle agregado | `projects.read` | miembros, hitos, entregables y avance derivado |
| `PATCH /api/v1/projects/:id` | editar | `projects.manage` | concurrencia optimista y auditoría |
| `POST/DELETE /api/v1/projects/:id/members[/:userId]` | asignar/revocar | `projects.manage` | rol de proyecto y actor válido |
| `POST/PATCH /api/v1/projects/:id/milestones[/:milestoneId]` | hitos | `projects.manage` | fechas/estado coherentes |
| `POST/PATCH /api/v1/projects/:id/deliverables[/:deliverableId]` | entregables | `projects.manage` | flujo de estado |
| `POST /api/v1/projects/:id/deliverables/:deliverableId/approve` | aprobar | permiso a definir | actor autorizado; portal hoy no tiene acción |
| `GET /api/v1/tasks` | lista/Kanban | `tasks.read` | responsable, proyecto, ticket, estado, fechas |
| `POST /api/v1/tasks` | crear | `tasks.manage` | exactamente un contexto o tarea interna autónoma |
| `GET /api/v1/tasks/:id` | detalle | `tasks.read` | alcance derivado del contexto |
| `PATCH /api/v1/tasks/:id` | editar/asignar | `tasks.manage` | auditar responsable/prioridad |
| `PATCH /api/v1/tasks/:id/status` | transición | `tasks.manage` | actor autorizado y máquina de estados |

### Tickets, comentarios y archivos

| Método y ruta | Propósito | Auth/permiso | Reglas |
| --- | --- | --- | --- |
| `GET /api/v1/tickets` | listar/filtrar | `tickets.read` | org, proyecto, estado, tipo, prioridad, responsable, fechas |
| `POST /api/v1/tickets` | crear | `tickets.create` | org/solicitante del contexto; proyecto propio; código DB |
| `GET /api/v1/tickets/:id` | detalle | `tickets.read` | comentarios internos se filtran en consulta/servicio |
| `PATCH /api/v1/tickets/:id/assignment` | asignar | `tickets.assign` | responsable elegible y auditoría |
| `PATCH /api/v1/tickets/:id/priority` | prioridad efectiva | permiso a definir | conservar requested priority y auditar |
| `POST /api/v1/tickets/:id/transitions` | cambio general permitido | `tickets.change_status` | tabla de transiciones, bloqueo optimista |
| `POST /api/v1/tickets/:id/resolve` | resolver con texto | `tickets.resolve` | resolución no vacía y `resolved_at` |
| `POST /api/v1/tickets/:id/confirm-resolution` | cliente confirma/cierra | permiso refinado | solo resolved, misma organización |
| `POST /api/v1/tickets/:id/reject-resolution` | cliente rechaza/reabre | permiso refinado | comentario obligatorio; regla por aprobar |
| `POST /api/v1/tickets/:id/comments` | comentar | permiso según visibilidad | actor del token; cliente nunca crea interno |
| `POST /api/v1/files/upload-intents` | preparar carga | `files.upload` | padre autorizado, MIME/tamaño permitidos |
| `POST /api/v1/files/:id/complete` | confirmar carga | `files.upload` | checksum/escaneo/estado |
| `POST /api/v1/files/:id/download-url` | descarga temporal | `files.read` | revalidar padre y organización en cada solicitud |
| `DELETE /api/v1/files/:id` | borrado lógico | permiso a definir | status/deleted_at y auditoría |

### Dashboards, auditoría y notificaciones

| Método y ruta | Propósito | Auth/permiso | Estado |
| --- | --- | --- | --- |
| `GET /api/v1/dashboard/internal` | indicadores internos | permisos de lectura | soportado con agregaciones |
| `GET /api/v1/dashboard/portal` | resumen cliente | membresía activa | soportado |
| `GET /api/v1/audit-events` | auditoría paginada | `audit.read` | soportado; salida redactada |
| `GET /api/v1/me/notifications` | bandeja | autenticado | requiere migración |
| `PATCH /api/v1/me/notifications/:id/read` | marcar leída | propietario | requiere migración |

## 9. Hallazgos y riesgos

### Críticos

1. **No existe backend ni autorización de servidor.** Las rutas privadas solo comprueban `usuario.tipo` en `App.tsx`, y el aislamiento del portal es un `.filter()` en el navegador. Cualquier integración ingenua expondría datos entre organizaciones. Corrección: contexto de autorización en Fastify y filtros de alcance obligatorios en repositorios/servicios. Migración: no.
2. **Vinculación Clerk insegura en el prototipo.** `AuthProvider.tsx` acepta `publicMetadata.appUserId` y luego coincidencia por correo. La especificación exige `clerk_user_id` estable y permisos de PostgreSQL. Corrección: usar el `userId` verificado por Clerk y buscar exclusivamente `app_users.clerk_user_id`; nunca confiar en metadatos o correo para autorizar. Migración: no.
3. **La UI permite transiciones arbitrarias de ticket.** `TicketDetalle.tsx:169` expone todos los estados y `AppStore.tsx:208` los aplica sin reglas. Cambiar directamente a resuelto/cerrado sin resolución violará `chk_tickets_resolution`; otros saltos podrían romper el proceso aunque la DB los acepte. Corrección: máquina de estados en servicio, endpoints de intención y pruebas de cada transición. Migración: no.

### Altos

1. **Notificaciones visibles y obligatorias sin tabla.** Afecta RF-059, RF-060, RF-061 y RF-063. Corrección: diseñar `notifications` con propietario, tipo, payload/enlace, `read_at` y timestamps. Migración: sí.
2. **Invitaciones/preautorización no representables.** `app_users.clerk_user_id NOT NULL` presupone usuario Clerk existente. Afecta RF-010 a RF-013. Corrección: tabla de invitaciones/accesos pendientes o flujo manual documentado. Migración: probablemente sí.
3. **Matriz RBAC no conciliada.** El SQL advierte que la referencia perdida indicaba 125 asignaciones pero inserta 142. Riesgo de exceso de privilegios. Corrección: revisión humana permiso por permiso y prueba de matriz. Migración/seed: sí.
4. **Permisos de cliente demasiado amplios.** `client_contact` y `client_manager` reciben `tickets.change_status`; ambos reciben `tickets.close`. Sin reglas de servicio podrían cambiar cualquier ticket de su organización a estados internos. Corrección: permiso `tickets.confirm_resolution`/`reject_resolution` o política contextual estricta. Migración/seed: sí.
5. **Integridad actor-organización depende del backend.** Solicitante, responsable, autor de comentario, aprobador y miembros de proyecto no están restringidos por FK a la organización correspondiente. Esto puede ser intencional para internos globales, pero permite combinaciones cruzadas si el servicio falla. Corrección: validaciones transaccionales centralizadas y pruebas de aislamiento. Migración: opcional si se crean reglas más expresivas.
6. **Archivos no están funcionalmente cerrados.** No se eligió proveedor, límites MIME/tamaño, antivirus ni estrategia de URLs temporales. El esquema guarda metadatos, no bytes. Corrección: definir un puerto `FileStorage` y proveedor antes del módulo. Migración: no necesariamente.
7. **Tareas no cumplen todos los requisitos obligatorios del documento.** Faltan comentarios y el archivo para tarea autónoma es imposible porque `files.organization_id` es obligatorio mientras la tarea autónoma exige organización nula. Corrección: decidir si se eliminan tareas autónomas o ajustar modelo de archivos/contexto. Migración: sí para soporte completo.

### Medios

1. **Avance de proyecto no definido.** La UI persiste porcentajes ficticios; SQL no tiene columna. Recomendación: derivar desde tareas completadas una vez aprobada fórmula y no persistir inicialmente. Migración: no.
2. **Tiempo utilizado ausente.** `estimated_minutes` existe; consumo real no. Recomendación: `task_time_entries` en vez de un contador mutable. Migración: sí.
3. **Notas/actividades comerciales ausentes.** El documento las declara obligatorias, pero no están en frontend ni SQL. Migración: sí si continúan en MVP.
4. **Ticket incompleto frente al documento.** Faltan categoría, servicio contratado, asignación a equipo, primera respuesta y SLA. Migración: sí según alcance aprobado.
5. **Prioridad solicitada vs efectiva no resuelta.** La UI solo envía una prioridad. Recomendación: el cliente fija `requested_priority`; la clasificación fija `priority`. Migración: no.
6. **Interés de lead ambiguo.** UI elige categoría, DB guarda servicio concreto. Recomendación: el formulario debe enviar `serviceId` obtenido del catálogo o el backend debe aceptar categoría como dato no persistido y resolver de forma inequívoca. Migración: opcional.
7. **`updated_at` no se actualiza solo.** El SQL no tiene triggers. Recomendación: todos los repositorios deben escribir `updated_at = now()` y probarlo. Migración: no.
8. **Borrado de archivos puede quedar inconsistente.** No hay `CHECK` que coordine `status='deleted'` con `deleted_at`. Recomendación: servicio transaccional o restricción posterior. Migración: opcional.
9. **NIT normalizado depende de aplicación.** No hay función/trigger de normalización. Recomendación: normalizador por país antes de escribir y prueba de unicidad. Migración: no.
10. **No hay último acceso.** La UI lo muestra, pero SQL solo registra sincronización. Recomendación: `last_login_at` si el dato sigue siendo requisito. Migración: sí.
11. **Listados sin paginación real.** Todos los datos se descargan y filtran localmente. Recomendación: cursores o página/tamaño con límites; índices adicionales se validarán con `EXPLAIN`. Migración: quizá índices.
12. **Auditoría puede capturar datos sensibles.** `old_values/new_values` es flexible. Recomendación: lista permitida y redacción antes de persistir. Migración: no.
13. **No se ha ejecutado el SQL en PostgreSQL 16.** La revisión estática indica orden y sintaxis plausibles, pero la compatibilidad final requiere base limpia y pruebas de restricciones. Migración: no.

### Bajos

1. `services.name` es único de forma sensible a mayúsculas; puede admitir duplicados visuales. Migración opcional con índice `lower(name)`.
2. La semilla frontend genera códigos de ticket con año 2026 y asigna siempre a `u4`; no debe migrarse esa lógica.
3. `primary_email` no es único. Es correcto no usarlo como identidad, pero las búsquedas administrativas deben tolerar coincidencias.
4. El README del frontend y del backend no documenta instalación, variables ni decisiones.
5. El chequeo TypeScript del frontend falla por configuración de tipos. Se corregirá en la fase de integración frontend, no ahora.

### Mejoras opcionales

- Índices trigram/FTS para búsquedas una vez exista volumen y medición.
- Outbox para notificaciones/correos si se incorporan efectos externos confiables.
- Historial de transiciones dedicado si auditoría genérica no cubre reportes SLA.
- RLS como defensa adicional después de estabilizar las políticas; no sustituye autorización de servicio.
- CMS separado para contenido público si el negocio necesita editar planes, FAQ, casos y páginas.

## 10. Arquitectura propuesta

```text
src/
  app.ts                    composición Fastify, sin listen
  server.ts                 arranque y cierre ordenado
  config/                   entorno validado y constantes
  plugins/                  DB, Clerk, seguridad, errores, OpenAPI
  db/
    client.ts
    schema/                 mapeo Drizzle exacto del SQL
  common/
    auth/                   contexto y políticas de alcance
    errors/                 errores tipados
    http/                   respuesta, paginación, idempotencia
    audit/                  escritura/redacción de auditoría
    files/                  puerto de almacenamiento
  modules/
    <modulo>/
      <modulo>.schemas.ts   entrada/salida
      <modulo>.repository.ts
      <modulo>.service.ts   reglas y transacciones
      <modulo>.routes.ts    adaptación HTTP
  tests/
```

Flujo de una solicitud privada:

1. Fastify asigna un `requestId` UUID, aplica límites, CORS y logs estructurados.
2. Clerk verifica la sesión.
3. El hook local carga `app_users` por `clerk_user_id`, comprueba estado y construye permisos/alcances.
4. El schema valida params/query/body y evita campos desconocidos.
5. El servicio ejecuta reglas de negocio y abre transacción cuando hay múltiples escrituras.
6. El repositorio usa exclusivamente Drizzle parametrizado y aplica filtros de organización/proyecto.
7. El servicio registra auditoría dentro de la misma transacción para operaciones sensibles.
8. El handler serializa una respuesta tipada; el manejador central traduce errores sin exponer stack ni secretos.

Decisiones arquitectónicas:

- Rutas delgadas; ninguna regla de negocio en handlers.
- Repositorios sin conocimiento de Clerk o HTTP.
- Clerk autentica; PostgreSQL decide estado, membresías, roles y permisos.
- Un `AuthorizationService` resuelve permisos globales y alcances, y recibe el recurso que se intenta operar.
- Máquinas de estado explícitas para lead, tarea, ticket, hito, entregable, membresía y archivo.
- Auditoría y cambios de negocio comparten transacción.
- Respuestas no devuelven filas Drizzle directamente; usan DTOs de salida.
- La API no expone `object_key`, errores de webhook ni metadatos sensibles.
- `app.ts` se puede inyectar en pruebas sin abrir puerto.

## 11. Plan de implementación

### Fase 0 — decisiones y validación de base

- Aprobar alcance MVP y resolver las brechas altas.
- Ejecutar el SQL original, sin editar, en PostgreSQL 16 limpio.
- Probar todos los `CHECK`, FK, índices únicos, semilla y rollback transaccional.
- Revisar y aprobar las 142 asociaciones RBAC.
- Criterio: acta de decisiones y baseline reproducible con checksum.

### Fase 1 — esqueleto seguro

- Configuración TypeScript estricta, variables validadas, Fastify, logs, CORS, límites, errores, health checks y cierre ordenado.
- Criterio: arranque con configuración válida, fallo temprano con configuración inválida, pruebas health y cero errores TypeScript.

### Fase 2 — Drizzle y persistencia

- Mapear las 19 tablas sin alterar nombres/tipos/restricciones.
- Pruebas de paridad SQL↔Drizzle y repositorio de transacciones.
- Criterio: migración baseline y `drizzle-kit check`/prueba equivalente sin drift.

### Fase 3 — Clerk, perfil local y RBAC

- Plugin Clerk, `/me`, webhooks firmados e idempotentes, estado local, roles y alcances.
- Pruebas 401/403, usuarios pending/blocked/deleted y aislamiento entre organizaciones.
- Criterio: ninguna ruta privada confía en correo, metadata o rol del cliente.

### Fase 4 — catálogo, leads y organizaciones

- Servicios públicos, captación, gestión de leads, conversión transaccional y clientes/contactos.
- Criterio: flujo visitante→lead→organización idempotente, auditado y paginado.

### Fase 5 — proyectos y tareas

- Proyectos, miembros, hitos, entregables, avance derivado y tareas.
- Antes de cerrar: migraciones aprobadas para comentarios/tiempo/archivos de tareas si siguen en MVP.
- Criterio: permisos por alcance y concurrencia probados.

### Fase 6 — tickets y archivos

- Tickets, clasificación, asignación, comentarios, transiciones, resolución/confirmación y auditoría.
- Integrar proveedor de objetos elegido, validación y descarga autorizada.
- Criterio: matriz completa de transiciones y prueba de que comentarios internos/archivos nunca cruzan organización.

### Fase 7 — notificaciones, dashboards y administración

- Migración de notificaciones aprobada, bandeja, lectura, métricas, auditoría y administración.
- Criterio: agregaciones paginadas/filtradas y permisos administrativos probados.

### Fase 8 — endurecimiento y entrega

- OpenAPI, pruebas unitarias/integración/seguridad, `EXPLAIN` de consultas críticas, límites de payload, redacción de logs, guía de operación y contrato de integración frontend.
- Criterio: arranque limpio, migraciones al día, pruebas verdes, cero errores TypeScript y checklist del “backend completamente funcional” satisfecho.

## 12. Archivos que se crearían o modificarían

Esta lista es el manifiesto propuesto; no se creó ninguno de estos archivos de implementación en esta fase.

### Raíz y documentación

- Modificar: `.gitignore`, `README.md`.
- Crear: `.env.example`, `package.json`, `package-lock.json`, `tsconfig.json`, `drizzle.config.ts`, `eslint.config.js`, `vitest.config.ts`.
- Crear: `docs/architecture.md`, `docs/api-conventions.md`, `docs/auth-and-rbac.md`, `docs/database-parity.md`, `docs/openapi.json`.
- Conservar como evidencia: `docs/auditoria-inicial.md`.

### Arranque, configuración y plugins

- Crear: `src/app.ts`, `src/server.ts`.
- Crear: `src/config/env.ts`, `src/config/constants.ts`.
- Crear: `src/plugins/database.ts`, `src/plugins/clerk.ts`, `src/plugins/auth-context.ts`, `src/plugins/security.ts`, `src/plugins/error-handler.ts`, `src/plugins/openapi.ts`.
- Crear: `src/types/fastify.d.ts`.

### Comunes

- Crear: `src/common/errors/app-error.ts`, `src/common/errors/error-codes.ts`.
- Crear: `src/common/http/api-response.ts`, `src/common/http/pagination.ts`, `src/common/http/idempotency.ts`.
- Crear: `src/common/auth/authorization.service.ts`, `src/common/auth/authorization.types.ts`, `src/common/auth/scope-filter.ts`.
- Crear: `src/common/audit/audit.service.ts`, `src/common/audit/audit-redaction.ts`.
- Crear: `src/common/files/file-storage.ts`, `src/common/files/file-policy.ts`.
- Crear: `src/common/state-machines/lead-transitions.ts`, `src/common/state-machines/task-transitions.ts`, `src/common/state-machines/ticket-transitions.ts`.

### Base de datos

- Crear: `src/db/client.ts`, `src/db/transaction.ts`.
- Crear: `src/db/schema/index.ts`, `src/db/schema/identity.ts`, `src/db/schema/rbac.ts`, `src/db/schema/organizations.ts`, `src/db/schema/services.ts`, `src/db/schema/leads.ts`, `src/db/schema/projects.ts`, `src/db/schema/tickets.ts`, `src/db/schema/tasks.ts`, `src/db/schema/files.ts`, `src/db/schema/audit.ts`.
- Crear después de aprobar baseline: `drizzle/0000_ilvox_baseline.sql`, `drizzle/meta/_journal.json` y metadatos generados por Drizzle.
- Crear solo tras aprobación de brechas: migraciones numeradas para invitaciones, notificaciones, actividad comercial, comentarios/tiempo de tareas y SLA; sus nombres definitivos se fijarán en el ADR correspondiente.

### Módulos

Cada módulo usa el patrón `schemas`, `repository`, `service`, `routes`.

- Crear: `src/modules/health/health.schemas.ts`, `health.service.ts`, `health.routes.ts`.
- Crear: `src/modules/identity/identity.schemas.ts`, `identity.repository.ts`, `identity.service.ts`, `identity.routes.ts`.
- Crear: `src/modules/users/users.schemas.ts`, `users.repository.ts`, `users.service.ts`, `users.routes.ts`.
- Crear: `src/modules/roles/roles.schemas.ts`, `roles.repository.ts`, `roles.service.ts`, `roles.routes.ts`.
- Crear: `src/modules/services/services.schemas.ts`, `services.repository.ts`, `services.service.ts`, `services.routes.ts`.
- Crear: `src/modules/leads/leads.schemas.ts`, `leads.repository.ts`, `leads.service.ts`, `leads.routes.ts`.
- Crear: `src/modules/organizations/organizations.schemas.ts`, `organizations.repository.ts`, `organizations.service.ts`, `organizations.routes.ts`.
- Crear: `src/modules/projects/projects.schemas.ts`, `projects.repository.ts`, `projects.service.ts`, `projects.routes.ts`.
- Crear: `src/modules/tasks/tasks.schemas.ts`, `tasks.repository.ts`, `tasks.service.ts`, `tasks.routes.ts`.
- Crear: `src/modules/tickets/tickets.schemas.ts`, `tickets.repository.ts`, `tickets.service.ts`, `tickets.routes.ts`.
- Crear: `src/modules/files/files.schemas.ts`, `files.repository.ts`, `files.service.ts`, `files.routes.ts`.
- Crear: `src/modules/audit/audit.schemas.ts`, `audit.repository.ts`, `audit.service.ts`, `audit.routes.ts`.
- Crear: `src/modules/dashboard/dashboard.schemas.ts`, `dashboard.repository.ts`, `dashboard.service.ts`, `dashboard.routes.ts`.
- Crear después de migración: `src/modules/notifications/notifications.schemas.ts`, `notifications.repository.ts`, `notifications.service.ts`, `notifications.routes.ts`.

### Pruebas

- Crear: `tests/helpers/build-test-app.ts`, `tests/helpers/database.ts`, `tests/helpers/auth.ts`, `tests/helpers/factories.ts`.
- Crear: `tests/unit/authorization.service.test.ts`, `tests/unit/lead-transitions.test.ts`, `tests/unit/task-transitions.test.ts`, `tests/unit/ticket-transitions.test.ts`, `tests/unit/audit-redaction.test.ts`.
- Crear: `tests/integration/health.test.ts`, `identity-webhook.test.ts`, `tenant-isolation.test.ts`, `leads.test.ts`, `organizations.test.ts`, `projects.test.ts`, `tasks.test.ts`, `tickets.test.ts`, `files.test.ts`, `audit.test.ts`, `rbac.test.ts`.

## Decisiones pendientes antes de escribir código de negocio

1. Confirmar si notificaciones, actividades comerciales y comentarios de tareas siguen siendo MVP obligatorio.
2. Aprobar o corregir las 142 asignaciones RBAC y separar permisos de confirmación/rechazo del cliente.
3. Elegir flujo de invitaciones y preautorización con Clerk.
4. Definir fórmula de avance de proyecto.
5. Definir máquina de estados de lead, tarea y ticket, incluido rechazo/reapertura.
6. Definir tratamiento de prioridad solicitada frente a prioridad efectiva.
7. Elegir proveedor de almacenamiento, límites, MIME permitidos y análisis de malware.
8. Decidir si el contenido público seguirá estático o requerirá CMS.
9. Definir si una membresía de organización ve todos los proyectos o solo proyectos asignados.
10. Confirmar si ticket debe relacionarse también con servicio, categoría, equipo y SLA.
