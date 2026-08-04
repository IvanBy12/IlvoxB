# Fase 7 — Plan de implementación IlvoxF ↔ IlvoxB

Este documento planifica la sustitución progresiva del estado ficticio de IlvoxF por IlvoxB.
No autoriza archivos, notificaciones, SLA, facturación, contactos independientes,
invitaciones externas, chat ni tareas derivadas directamente de tickets.

## 1. Principios de ejecución

1. Integrar verticalmente por módulo; no borrar `AppStore` y el seed antes de que todas sus
   pantallas consumidoras tengan reemplazo.
2. Clerk autentica; PostgreSQL autoriza.
3. El frontend nunca envía como autoridad roles, requester, tenant derivado ni IDs generados.
4. Las acciones visibles se derivan de `/me`, pero cada request debe tolerar 403/404.
5. Toda mutación que tenga `updatedAt` debe enviar `expectedUpdatedAt` cuando el contrato lo
   permita y resolver 409 mediante refetch.
6. Una pantalla no lista para red debe permanecer oculta, no conectada a un endpoint ficticio.
7. La cache se particiona por usuario/scope y se limpia al cerrar sesión.
8. Los tipos API y los view models de UI son capas distintas.

## 2. Arquitectura propuesta

La estructura actual es simple y coherente; se conserva `app/` y se añaden capas, sin
reorganización masiva:

```text
src/app/
├── api/
│   ├── api-client.ts
│   ├── api-error.ts
│   ├── api-paths.ts
│   ├── api-types.ts
│   ├── query-client.ts
│   └── modules/
│       ├── identity.api.ts
│       ├── services.api.ts
│       ├── leads.api.ts
│       ├── organizations.api.ts
│       ├── projects.api.ts
│       ├── tasks.api.ts
│       └── tickets.api.ts
├── auth/
│   ├── AuthProvider.tsx
│   ├── ProtectedRoute.tsx
│   ├── PermissionGate.tsx
│   ├── useApiToken.ts
│   └── clerk.ts
├── features/
│   ├── services/{queries,adapters,types}.ts
│   ├── leads/{queries,mutations,adapters,types}.ts
│   ├── organizations/{queries,mutations,adapters,types}.ts
│   ├── projects/{queries,mutations,adapters,types}.ts
│   ├── tasks/{queries,mutations,adapters,types}.ts
│   └── tickets/{queries,mutations,adapters,types}.ts
├── components/shared/
│   ├── AsyncBoundary.tsx
│   ├── EmptyState.tsx
│   ├── ErrorState.tsx
│   └── ConflictDialog.tsx
├── data/
│   ├── api-enums.ts
│   └── view-enums.ts
├── mock/                       # retirar al final de 7.6
└── store/AppStore.tsx          # reducir y retirar por consumidores
```

`VITE_API_BASE_URL` representa `http://127.0.0.1:3001` en desarrollo. `api-paths.ts`
mantiene `/api/v1` para negocio y `/me` para identidad. No se debe concatenar `/api/v1`
globalmente y luego hacer excepciones con manipulación de strings.

### Contrato de `api-client`

- `request<T>({ path, method, query, body, signal, timeoutMs, auth })`;
- obtiene token fresco mediante callback inyectado, no desde `localStorage`;
- `Authorization: Bearer ...` solo para rutas protegidas;
- combina señal del consumidor con timeout y distingue abort de fallo de red;
- valida `content-type`, desempaqueta `{ data }` y normaliza `{ error }`;
- conserva `error.code`, `error.message`, `error.requestId`, status y details;
- nunca registra token, body sensible ni headers de autenticación;
- 401: revalidar sesión y llevar a login si Clerk ya no está autenticado;
- 403: estado “sin permiso” para la acción;
- 404: mensaje neutral “recurso no disponible”;
- 409: invalidar/refetch y abrir conflicto;
- 413: indicar límite;
- 429: respetar espera disponible, sin bucle automático agresivo;
- errores de red: retry manual y retry acotado solo en GET idempotente.

## 3. Fase 7.1 — Fundaciones

### Objetivo

Crear una sesión local basada en Clerk + `/me`, un cliente HTTP seguro, cache remota,
tipos/adaptadores base y guards visuales sin conectar todavía todas las pantallas.

### Archivos esperados

- IlvoxF: `.env.example`, `src/vite-env.d.ts`, `vite.config.ts` si se fija host/puerto.
- `app/api/*`, `app/auth/ProtectedRoute.tsx`, `PermissionGate.tsx`, `useApiToken.ts`.
- Actualización controlada de `AuthProvider.tsx`, `App.tsx` y layouts.
- Tests de cliente, errores, token, guards y adapters.
- IlvoxB: solo ajuste de `CORS_ORIGINS`/`CLERK_AUTHORIZED_PARTIES` por entorno; no endpoint.

### Dependencias

- Añadir `@tanstack/react-query`.
- Reutilizar Clerk, React Router, Sonner y React Hook Form.
- No añadir Axios. Zod queda diferido hasta decidir validación de formularios.

### Orden

1. Corregir typecheck del frontend y añadir tipos Vite.
2. Crear `.env.example` solo con nombres/valores públicos de ejemplo.
3. Unificar origen `127.0.0.1:5173` en Vite, CORS y Clerk authorized parties.
4. Implementar `api-error`, paths y cliente con abort/timeout.
5. Instalar/configurar QueryClient.
6. Implementar token provider y consulta `/me`.
7. Sustituir `ClerkSessionBridge` y `RequireRole` por sesión/permisos locales.
8. Ocultar documentos, notificaciones, auditoría y RBAC sin endpoint.
9. Añadir boundaries globales y limpieza de cache en logout.

### Riesgos

- Loop 401/login; token obsoleto; cache compartida entre usuarios; origen inconsistente;
  tratar 404 scoped como 403; habilitar UI antes de cargar `/me`.

### Criterios de aceptación

- No existe login demo en builds integrados.
- Una sesión Clerk válida con perfil local activo obtiene `/me`; un perfil ausente/bloqueado
  muestra acceso no habilitado sin crear usuario implícitamente.
- Ningún request protegido sale sin Bearer y ningún token se persiste o registra.
- Logout borra cache y vuelve a `/login`.
- 401/403/404/409/413/429 y red tienen estados verificables.
- Typecheck, lint y build pasan; CORS funciona desde el origen elegido.

### Pruebas

- Unitarias de envelopes, timeout, abort, query serialization y errores.
- Integración con respuestas 200/401/403/404/409/413/429 simuladas.
- E2E: login, perfil local ausente, logout y cambio entre usuarios sin fuga de cache.
- Prueba CORS positiva para `127.0.0.1:5173` y negativa para origen no autorizado.

## 4. Fase 7.2 — Público

### Objetivo

Conectar catálogo público y captura de leads, conservando contenido comercial estático.

### Archivos esperados

- `api/modules/services.api.ts`, `leads.api.ts`.
- `features/services/*`, `features/leads/*`.
- `pages/public/Servicios.tsx`, opcional `ServicioDetalle.tsx`.
- `components/shared/LeadForm.tsx`; rutas si se aprueba detalle.

### Dependencias

Fundaciones 7.1. React Hook Form ya disponible. Zod solo si se adopta como estándar para
todos los formularios, no para un único formulario.

### Orden

1. Listado de servicios con loading/empty/error.
2. Adaptador de categorías y selección por UUID.
3. LeadForm alineado a `PublicLeadInput`.
4. Pending, doble submit, éxito, validación y 429.
5. Decidir detalle público y política para catálogo vacío.

### Riesgos

Catálogo backend vacío; mensaje obligatorio en backend; empresa/teléfono nullables;
duplicar labels; retry que duplique leads (la captura no es idempotente por header).

### Criterios de aceptación

- Servicios provienen de API, no de seed.
- Se envía `serviceId`, no categoría.
- Ningún lead puede enviar status, assignee o converted organization.
- El botón queda bloqueado durante POST y el retry requiere acción consciente.
- El contenido corporativo sigue disponible si la API falla; el catálogo muestra error real.

### Pruebas

Adapters de enum, formulario accesible, 201, 400, 404 de service, 429, red, catálogo vacío,
responsive móvil y navegación con teclado.

## 5. Fase 7.3 — Sesión y usuario

### Objetivo

Cerrar una autenticación privada por invitación sobre Clerk, sin registro público,
OAuth social ni Clerk Organizations. Clerk mantiene identidad, credenciales y sesión;
PostgreSQL conserva la autoridad exclusiva sobre activación, roles, memberships,
permisos y scopes.

### Archivos esperados

- `pages/public/Login.tsx` sin enlace ni ruta de registro público.
- `pages/public/InvitationAcceptance.tsx` para tickets oficiales de Clerk.
- `AuthProvider.tsx`, `ProtectedRoute.tsx`, `PermissionGate.tsx`.
- Estados separados de perfil no sincronizado, pendiente e inactivo.
- Políticas de redirects locales, retry acotado y mensajes seguros de invitación.
- Webhook `user.created`, `user.updated` y `user.deleted` como único puente hacia
  `app_users`.

### Dependencias

7.1 y 7.2 completadas. Instancia Clerk de desarrollo en modo restringido, email y
contraseña habilitados, y webhook de sincronización operativo. No depende de planes Pro.

### Orden

1. Loading y SignedIn/SignedOut.
2. Activar `Restricted mode` y retirar signup/OAuth público.
3. Login por email + contraseña o código y recuperación administrada por Clerk.
4. Aceptación exclusiva de invitación mediante `__clerk_ticket`.
5. Sincronización webhook e identidad `/me`.
6. Redirect: `internal` hacia `/app`; cliente con membership hacia `/portal`.
7. Guard por autenticación, gates por permisos, logout, expiración y cambio de usuario.

### Riesgos

Redirect a `/app` antes de `/me`, usuario Clerk aún no sincronizado, depender de metadata,
confundir Clerk Organization con organización ILVOX, aceptar un redirect externo, exponer
signup por una subruta de Clerk o reintentar indefinidamente un perfil pendiente/inactivo.

### Criterios de aceptación

- No existe ruta, enlace ni proveedor de registro público.
- Una invitación oficial válida puede configurar credenciales sin elegir role,
  organización, status, permisos ni metadata.
- Login, recuperación y verificación quedan dentro de los métodos Clerk aprobados.
- Usuario no sincronizado o no activo no entra a portales.
- Roles/permisos se muestran desde PostgreSQL; metadata Clerk no autoriza.
- Un deep link protegido se reanuda después del login si el scope lo permite.
- Logout y cambio de usuario limpian la cache.
- El webhook verifica firma, es idempotente, serializa eventos concurrentes y rechaza
  eventos fuera de orden.

### Pruebas

Contrato estático de auth cerrada, tickets ausentes/inválidos/expirados/usados, redirects
externos, retry exclusivo del perfil no sincronizado, estados pending/inactive, token
expirado, logout, cambio de usuario, firma/idempotencia/orden de webhook y un smoke real
con un correo invitado antes de producción.

## 6. Fase 7.4 — Portal cliente

### Objetivo

Conectar organizaciones, proyectos, hitos, entregables y ciclo completo de tickets de
cliente. Archivos y tareas de ticket permanecen ocultos.

### Archivos esperados

- `features/organizations`, `projects`, `tickets`.
- Páginas portal existentes y `PortalLayout.tsx`.
- Componentes para create ticket, comentarios, confirmar, rechazar y reabrir.
- Eliminación de navegación y ruta `Documentos`.

### Dependencias

7.1–7.3. Permisos/memberships correctos en PostgreSQL. No depende de archivos.

### Orden

1. Selector/contexto de organización si el usuario tiene más de una.
2. Dashboard derivado, claramente no “métrica definitiva”.
3. Listado/detalle de proyectos.
4. Hitos y entregables.
5. Listado/detalle de tickets.
6. Crear ticket con organization/project autorizados.
7. Comentarios cliente.
8. Confirmar, rechazar y reabrir con `expectedUpdatedAt`.

### Riesgos

Fuga cross-tenant, asumir una sola organización, filtrar comentarios internos en navegador,
mostrar `avance` inventado, enviar requester, reintentar POST, perder comentario tras 409.

### Criterios de aceptación

- No existe `clienteId` como fuente de scope en el navegador.
- Un UUID de otra organización devuelve estado neutral y no filtra datos.
- Comentarios internos nunca llegan al portal.
- Create ticket no envía requester ni prioridad operativa.
- Confirm/reject/reopen respetan estado, reason y concurrencia.
- Documentos y tareas desde ticket no aparecen.

### Pruebas

Integración/E2E multi-tenant negativa, 404 scoped, comentarios internos, ticket standalone/
organizacional/proyecto, confirm/reject/reopen, 409 con refetch, responsive y accesibilidad.

## 7. Fase 7.5 — Área interna

### Objetivo

Conectar servicios, leads, organizaciones, memberships, proyectos, miembros, hitos,
entregables, tareas y tickets conforme a permisos reales.

### Archivos esperados

- Features de los seis módulos y actualización de páginas internas.
- Nuevos drawers/rutas para detalle y formularios que hoy faltan.
- Componentes de transición que calculan targets permitidos.
- Separación de “Administración de servicios” de RBAC/usuarios no disponible.

### Dependencias

7.1–7.4, catálogo de usuarios locales elegibles disponible por los contratos existentes o
una decisión explícita. Si no hay forma autorizada de listar usuarios elegibles, los
selectores de asignación se difieren; no se inventa un endpoint.

### Orden

1. Servicios admin.
2. Organizaciones/clientes y contactos existentes.
3. Proyectos, miembros, hitos y entregables.
4. Tareas.
5. Prospectos y tickets.
6. Personal queda diferido.

### Riesgos

No existe endpoint general de usuarios para poblar assignees; tablas grandes sin paginación;
drag inválido; conversión de lead mal parametrizada; `expectedUpdatedAt` omitido; permisos
globales interpretados como acceso total sin `organizations.access_all`.

### Criterios de aceptación

- Cada botón de mutación requiere capability/permiso visual y maneja rechazo backend.
- Kanban solo ofrece transiciones válidas; rollback/refetch ante 409.
- Conversión soporta los tres modos y conserva errores de conflicto.
- Organización, proyecto, tarea y ticket usan endpoints de intención para status/assignee.
- No se muestra CRUD RBAC ni auditoría mientras no exista endpoint.

### Pruebas

Unitarias de adapters/state machines visuales; integración por permiso/scope; E2E por rol
`super_admin`, `admin`, `sales`, `support_agent`, `project_lead`, `contributor`; negativos
cross-organization; concurrencia; paginación/búsqueda/orden; formularios y teclado.

### Registro de Fase 7.5A

El 4 de agosto de 2026 se completaron únicamente los puntos 1 y 2 del orden aprobado.
Servicios administrativos y organizaciones/clientes consumen los contratos reales con
TanStack Query, token fresco, gates visuales y autoridad backend. Se implementaron las
memberships existentes, incluida su revocación.

Crear memberships y asignar responsable interno quedaron diferidos porque el backend no
expone un catálogo general seguro de usuarios candidatos. La UI explica y deshabilita solo
esas acciones; no consulta Clerk ni usa seed. Usuarios, RBAC, auditoría y Personal siguen
ocultos. Proyectos, tareas, prospectos y tickets internos no fueron iniciados.

La evidencia está en `phase-7-internal-a-implementation.md` y
`phase-7-internal-a-test-results.md`.

## 8. Fase 7.6 — Calidad y cierre

### Objetivo

Eliminar mocks restantes, cerrar regresiones, accesibilidad, responsive, documentación y
build de producción.

### Archivos esperados

- Eliminación final de `app/mock/seed.ts` y reducción/eliminación de `AppStore`.
- Tests unitarios, integración y E2E.
- README, guía de entorno, matriz actualizada y runbook de errores.
- Sin outputs de build versionados accidentalmente.

### Dependencias

Todos los bloques anteriores aceptados. Datos de prueba controlados en backend.

### Orden

1. Buscar consumidores restantes de mock/store y botones sin acción.
2. Eliminar código demo y dependencias realmente no usadas.
3. Cobertura de errores, scope y concurrencia.
4. Matriz responsive y accesibilidad WCAG.
5. Build producción y smoke contra backend local.
6. Documentación y sign-off.

### Riesgos

Retirar seed antes de migrar un consumidor, tests que solo cubren happy path, fuga de datos
entre sesiones, claims comerciales confundidos con datos operativos.

### Criterios de aceptación

- Cero imports desde `mock/`; cero roles/usuarios/organizaciones/tickets hardcoded.
- Cero botones operativos sin acción real.
- Cero endpoints ficticios para funciones no disponibles.
- Typecheck, lint, unit, integration, E2E y build pasan.
- Responsive verificado al menos en 360, 768, 1024 y 1440 px.
- Navegación por teclado, foco, labels, errores anunciados y contraste verificados.
- Logout y cambio de usuario no conservan datos de otra sesión.
- Documentación enumera funciones ocultas y límites reales.

### Pruebas de cierre

- Contract tests contra OpenAPI y envelopes reales.
- Smoke público sin auth y portales con auth.
- Matriz de permisos/scopes y ataques IDOR.
- 401/403/404/409/413/429, offline, timeout y abort.
- Tests de doble submit y no repetición automática de mutaciones.
- Auditoría manual de secretos en bundle: solo publishable key y URL pública.

## 9. Gates entre fases

| Gate | Requisito |
| --- | --- |
| 7.1 → 7.2 | Sesión/token/cliente/errores/CORS probados |
| 7.2 → 7.3 | Público sin seed y sin regresión comercial |
| 7.3 → 7.4 | `/me`, redirects, expiración y logout aceptados |
| 7.4 → 7.5 | Portal multi-tenant y tickets cliente aceptados |
| 7.5 → 7.6 | Todos los módulos disponibles conectados o explícitamente ocultos |
| Cierre | Cero mocks operativos, pruebas completas y límites documentados |

## 10. Decisión de preparación

Esta decisión corresponde a la auditoría inicial: IlvoxF e IlvoxB estaban
**listos con condiciones** para iniciar 7.1, sujetos a cliente HTTP/cache, token
Bearer, `/me`, errores remotos, guards, CORS/origen y typecheck. Los registros de
ejecución siguientes documentan el cierre posterior de esas condiciones.

## 11. Registro de ejecución de Fase 7.1

Fase 7.1 fue implementada el 27 de julio de 2026 sin iniciar los bloques
funcionales posteriores. Se completaron cliente HTTP, token Clerk, `/me`,
TanStack Query, errores, guards, PermissionGate, logout/cambio de usuario,
origen/CORS, typecheck y ocultamiento de capacidades sin endpoint.

La arquitectura final y los límites están en
`phase-7-foundations-implementation.md`; los comandos y resultados reproducibles
están en `phase-7-foundations-test-results.md`.

El gate 7.1 → 7.2 fue cerrado posteriormente mediante el smoke autenticado real
documentado en `phase-7-authenticated-smoke.md`.

## 12. Registro de ejecución de Fase 7.2

Fase 7.2 conectó exclusivamente el módulo público:

- `GET /api/v1/services` y detalle público;
- `POST /api/v1/leads` para contacto, diagnóstico y cotización;
- tipos/adaptadores, source map, UUID opcional y TanStack Query;
- loading, vacío, error, retry, validación, 201, 400, 404, 413, 429, 500, red y
  timeout;
- bloqueo de doble submit, POST sin retry y accesibilidad;
- corrección contractual de rate limit `500` → `429` y exposición CORS de
  `Retry-After`.

No se conectaron módulos internos o portal. No se modificaron OpenAPI,
migraciones, tablas ni RBAC. La evidencia está en
`phase-7-public-module-implementation.md` y
`phase-7-public-module-test-results.md`. Fase 7.3 no fue iniciada.

## 13. Registro de ejecución de Fase 7.3

Fase 7.3 implementó exclusivamente autenticación privada por invitación:

- instancia Clerk de desarrollo Hobby con `Restricted mode` habilitado;
- login por email con contraseña o código, sin conexiones sociales/SSO;
- cero ruta o enlace de signup público;
- aceptación mediante ticket oficial Clerk en `/invitacion/aceptar`;
- estados distintos para perfil no sincronizado, pendiente e inactivo;
- retry acotado solo para consistencia eventual;
- redirects locales, deep links autorizados y limpieza de cache;
- códigos backend explícitos y validación del webhook existente.

No se habilitó allowlist, producción, enterprise SSO ni ninguna función Pro.
No se modificaron migraciones, tablas, OpenAPI, RBAC ni módulos de Fase 7.4.
La implementación y sus resultados están en
`phase-7-invitation-auth-implementation.md` y
`phase-7-invitation-auth-test-results.md`.

## 14. Registro de ejecución de Fase 7.4

Fase 7.4 conectó exclusivamente el portal del cliente:

- contexto 0/1/múltiples organizaciones derivado de `/me`;
- cancelación y eliminación de cache al cambiar contexto o identidad;
- proyectos, hitos y entregables reales, sin campo `avance`;
- tickets standalone, organizacionales y de proyecto;
- comentarios cliente, confirmación, rechazo y reapertura;
- `expectedUpdatedAt`, 409 preservando texto y mutaciones sin retry;
- 404 neutral, errores parciales, retry manual y paginación del servidor;
- retiro de los seis componentes mock reemplazados.

El smoke PostgreSQL `PHASE74_SMOKE_` corrigió y cubrió dos brechas reales:
`projects.read` elegía un scope incompatible para `client_contact`, y un cliente
con rol de proyecto podía activar lectura interna de comentarios. La política
de scopes fue especializada y `includeInternal` exige ahora actor interno.

El área interna, `AppStore` y `seed.ts` permanecen sin migrar. Archivos, tareas,
notificaciones, auditoría, RBAC, SLA, facturación, chat y métricas definitivas
siguen ocultos. No se modificaron OpenAPI, tablas o migraciones y Fase 7.5 no
fue iniciada. Véanse `phase-7-client-portal-implementation.md` y
`phase-7-client-portal-test-results.md`.

## 15. Registro de ejecución de Fase 7.5A

Servicios administrativos, organizaciones/clientes y memberships existentes quedaron
conectados a contratos reales. Añadir membership y cambiar account manager se difirieron
por ausencia de catálogo seguro. El detalle se encuentra en los documentos
`phase-7-internal-a-*`.

## 16. Registro de ejecución de Fase 7.5B

Fase 7.5B conectó exclusivamente proyectos, miembros existentes, hitos, entregables y
tareas internas standalone/de proyecto:

- paginación, búsqueda, filtros y orden reales;
- CRUD y transiciones según enums/state machines backend;
- `expectedUpdatedAt` con formularios preservados tras 409;
- asignación de tareas solo al usuario autenticado o líder de proyecto conocido;
- tareas reales dentro del detalle de proyecto;
- 404 neutral, 403 de escritura, errores/retry independientes y locks de submit;
- retiro de `AppStore`/seed únicamente de las tres pantallas 7.5B;
- smoke multi-organización/proyecto con `residualFixtures: 0`;
- responsive 360/768/1024/1440 y accesibilidad focalizada.

Añadir miembros, selector general de líder/assignee y desasignar tareas permanecen
diferidos por contrato. `TaskAssignBodySchema` exige un UUID y no admite `null`. No se
inició 7.5C: Prospectos y Tickets internos continúan pendientes, y Personal continúa
diferido. Véanse `phase-7-internal-b-implementation.md` y
`phase-7-internal-b-test-results.md`.

**Decisión:** Fase 7.5B cerrada técnicamente; el siguiente bloque sigue siendo 7.5C y no
fue iniciado por esta ejecución.
