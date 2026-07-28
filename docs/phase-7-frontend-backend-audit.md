# Fase 7.0 — Auditoría IlvoxF ↔ IlvoxB

Fecha de corte: 27 de julio de 2026  
Alcance: inspección read-only de código, configuración, contratos y runtime local.  
Decisión: **lista con condiciones** para iniciar Fase 7.1.

## 1. Rutas y estado Git inicial

| Proyecto | Ruta real | Rama | HEAD | Working tree inicial |
| --- | --- | --- | --- | --- |
| IlvoxF | `C:\Users\leopa\OneDrive\Documentos\Proyectos\IlvoxF` | `dev` | `99136a843016df6449c21ac06e970f8243f97a65` | `package-lock.json` modificado |
| IlvoxB | `C:\Users\leopa\OneDrive\Documentos\Proyectos\IlvoxB` | `main` | `a0dbbe2e0bec210a4f853e663adcf0e23669c6bb` | Cambios preexistentes en README, documentación, `package.json` y scripts de Fase 6 |

Los cambios preexistentes son propiedad del usuario y se preservan. Esta auditoría no hizo
stage, commit, push, pull, reset, merge ni rebase.

## 2. Stack frontend confirmado

| Área | Hallazgo |
| --- | --- |
| Framework | React `18.3.1`, SPA |
| Build | Vite `6.3.5`, `@vitejs/plugin-react` `4.7.0` |
| Lenguaje | TypeScript `7.0.2`, `strict`, `noEmit`, resolución `bundler` |
| Gestor | `package-lock.json` v3 confirma npm; existe `pnpm-workspace.yaml`, pero no `pnpm-lock.yaml` ni `packageManager` |
| Estilos | Tailwind CSS `4.1.12`, CSS tokens propios, componentes estilo shadcn/Radix |
| UI | Radix UI, Lucide, Sonner, Recharts, Motion; MUI y Emotion están instalados pero no se importan |
| Router | `react-router` `7.13.0` con `BrowserRouter`, rutas declarativas y layouts anidados |
| Estado | Context + `useState` en `AppStore`; todo el negocio vive en memoria |
| Formularios | Estado local/manual; `react-hook-form` está instalado, pero las pantallas no lo usan |
| Validación | HTML y comprobaciones manuales; no hay schema de validación frontend |
| Auth | Clerk React `5.61.9`, activado solo si existe `VITE_CLERK_PUBLISHABLE_KEY`; fallback demo |
| HTTP/query | No hay `fetch`, Axios, cliente HTTP, TanStack Query, cache ni retry |
| Alertas | Sonner, usado en mutaciones locales |
| Idioma | Solo español hardcoded; no hay i18n |
| Tema | Claro/oscuro propio; solo la preferencia de tema se persiste en `localStorage` |
| Responsive | Uso amplio de breakpoints Tailwind; no hubo prueba visual por viewport en esta auditoría |

El lockfile confirma las dependencias realmente instaladas. La comprobación TypeScript
read-only falla por dos defectos preexistentes: falta la declaración `ImportMeta.env` y
`Logo.tsx` resuelve una imagen mediante una ruta inválida. El backend sí pasa `npm run
typecheck`.

## 3. Arquitectura frontend actual

```text
src/
├── app/
│   ├── App.tsx                 # router y providers
│   ├── auth/                   # activación Clerk y bridge hacia el mock
│   ├── components/
│   │   ├── shared/             # formularios, badges, kanban, comentarios
│   │   └── ui/                 # primitives Radix/shadcn
│   ├── data/                   # tipos y metadatos de presentación
│   ├── layouts/                # público, interno y portal
│   ├── mock/seed.ts            # autoridad actual de todos los datos
│   ├── pages/{public,internal,portal}/
│   ├── store/AppStore.tsx      # sesión demo y mutaciones en memoria
│   └── theme/
├── imports/                    # activos y textos importados
├── main.tsx
└── styles/
```

No existen carpetas `api`, `services`, `hooks` de negocio, stores remotos, schemas de
formularios ni guards basados en permisos reales. `RequireRole` está dentro de `App.tsx`.

## 4. Inventario completo de rutas

Estado: `mock` significa que la vista y sus acciones consumen `AppStore`; `estático`
significa contenido comercial sin necesidad de API.

| URL | Archivo / layout | Tipo / rol esperado | Datos y acciones | Estado | Responsive | Backend potencial | Riesgo principal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | `pages/public/Home.tsx` / `PublicLayout` | Pública | Landing, escenarios, proceso, casos, FAQ, CTA | Estático | Sí por código | Ninguno; `GET /api/v1/services` solo para catálogo dinámico | Claims y casos requieren validación editorial |
| `/servicios` | `pages/public/Servicios.tsx` / `PublicLayout` | Pública | Cinco categorías y CTA | Estático | Sí por código | `GET /api/v1/services` | Categorías y campos no coinciden; no hay enlaces a detalle |
| `/nosotros` | `pages/public/Nosotros.tsx` / `PublicLayout` | Pública | Contenido corporativo | Estático | Sí por código | Ninguno | Ninguno técnico |
| `/portafolio` | `pages/public/Portafolio.tsx` / `PublicLayout` | Pública | Tres casos hardcoded | Estático | Sí por código | Ninguno | Presenta cifras como reales sin autoridad backend |
| `/planes` | `pages/public/Planes.tsx` / `PublicLayout` | Pública | Planes/precios y CTA | Estático | Sí por código | Ninguno | Promete SLA, funcionalidad no disponible |
| `/contacto` | `pages/public/Contacto.tsx` / `PublicLayout` | Pública | Datos de contacto y `LeadForm` | Mock | Sí por código | `POST /api/v1/leads`, `GET /api/v1/services` | Copia datos a memoria; empresa/teléfono hoy obligatorios y mensaje opcional, inverso al contrato |
| `/diagnostico` | `pages/public/Diagnostico.tsx` / `PublicLayout` | Pública | `LeadForm` con origen diagnóstico | Mock | Sí por código | `POST /api/v1/leads` | Mismo desfase de contrato |
| `/cotizacion` | `pages/public/Cotizacion.tsx` / `PublicLayout` | Pública | `LeadForm` con origen cotización | Mock | Sí por código | `POST /api/v1/leads` | Mismo desfase de contrato |
| `/login` | `pages/public/Login.tsx` / sin layout | Autenticación | Clerk `SignIn` o selector de cuentas demo | Parcial | Sí por código | Clerk + `GET /me` | Redirect fijo a `/app`; rol tomado del mock/metadata, registro apunta a la misma ruta |
| `/app` | `pages/internal/Dashboard.tsx` / `InternalLayout` | Interna / permisos efectivos | KPIs, gráficas, proyectos/tickets | Mock | Parcial | Composición de leads, organizations, projects, tasks, tickets | No hay métricas definitivas; carga completa sería costosa/paginada |
| `/app/prospectos` | `pages/internal/Prospectos.tsx` / `InternalLayout` | Interna / sales-admin | Kanban, transición, conversión | Mock | Parcial | Rutas `/api/v1/leads*` | Drag permite estados inválidos; conversión necesita elegir modo/organización |
| `/app/clientes` | `pages/internal/Clientes.tsx` / `InternalLayout` | Interna | Buscar y listar empresas | Mock | Parcial | `GET /api/v1/organizations` | “Cliente” debe migrar a organización; conteos requieren consultas adicionales |
| `/app/clientes/:id` | `pages/internal/ClienteDetalle.tsx` / `InternalLayout` | Interna | Organización, contactos, proyectos, tickets | Mock | Parcial | organization, members, projects, tickets | Contactos independientes no existen; memberships sí |
| `/app/proyectos` | `pages/internal/Proyectos.tsx` / `InternalLayout` | Interna | Tarjetas y navegación | Mock | Sí por código | `GET /api/v1/projects` | `avance` no existe como campo backend |
| `/app/proyectos/:id` | `pages/internal/ProyectoDetalle.tsx` / `InternalLayout` | Interna | Proyecto, equipo, hitos, entregables, tareas | Mock | Parcial | project + members + milestones + deliverables + tasks | Requiere consultas coordinadas; sin archivos |
| `/app/tareas` | `pages/internal/Tareas.tsx` / `InternalLayout` | Interna | Crear y mover tareas en Kanban | Mock | Parcial | `/api/v1/tasks*` | Drag permite saltos inválidos; `ticketId` y tiempo utilizado no existen |
| `/app/tickets` | `pages/internal/Tickets.tsx` / `InternalLayout` | Interna | Listar y filtrar por estado | Mock | Parcial | `GET /api/v1/tickets` | Tabla no tiene búsqueda/paginación remota ni acciones de asignación/prioridad |
| `/app/tickets/:id` | `pages/internal/TicketDetalle.tsx` / `InternalLayout` | Interna | Comentarios, estado, resolución | Mock | Parcial | ticket, comments, assign, priority, transition | Selector permite cualquier estado; no usa `expectedUpdatedAt` |
| `/app/administracion` | `pages/internal/Administracion.tsx` / `InternalLayout` | Administración | Usuarios, matriz RBAC, servicios | Mock/estático | Parcial | Solo `/api/v1/admin/services*` | No hay rutas funcionales de usuarios/roles/permisos; matriz hardcoded peligrosa |
| `/app/auditoria` | `pages/internal/Auditoria.tsx` / `InternalLayout` | Administración | Timeline de auditoría | Mock | Parcial | Ninguno funcional | `audit.read` existe como permiso, no como endpoint |
| `/portal` | `pages/portal/PortalDashboard.tsx` / `PortalLayout` | Cliente | Resumen de proyectos/tickets/entregables | Mock | Sí por código | organizations, projects, tickets | Aislamiento solo por filtro navegador; métricas no definitivas |
| `/portal/proyectos` | `pages/portal/MisProyectos.tsx` / `PortalLayout` | Cliente | Listar proyectos scoped | Mock | Sí por código | `GET /api/v1/projects` | Scope debe venir de SQL, no de `clienteId` local |
| `/portal/proyectos/:id` | `pages/portal/PortalProyectoDetalle.tsx` / `PortalLayout` | Cliente | Proyecto, hitos y entregables | Mock | Sí por código | project + milestones + deliverables | El redirect local no es autorización; `avance` requiere adaptación |
| `/portal/tickets` | `pages/portal/MisTickets.tsx` / `PortalLayout` | Cliente | Listar y crear ticket | Mock | Sí por código | `GET/POST /api/v1/tickets` | Frontend envía cliente/solicitante; backend los deriva y distingue prioridad solicitada |
| `/portal/tickets/:id` | `pages/portal/PortalTicketDetalle.tsx` / `PortalLayout` | Cliente | Detalle, comentario, confirmar solución | Mock | Sí por código | ticket, comments, confirm, reopen | Falta rechazo/reapertura; confirmación actual cambia estado local directamente |
| `/portal/documentos` | `pages/portal/Documentos.tsx` / `PortalLayout` | Cliente | Lista entregables como documentos; botón descargar | Incompleto | Parcial | Ninguno | Descarga activa sin acción ni backend; debe ocultarse |
| `*` | `App.tsx` | Todas | Redirección a `/` | Funcional local | N/A | N/A | Oculta errores de URL; una 404 de API es otra categoría |

No existen rutas de detalle público de servicio, perfil, políticas, registro separado,
recuperación separada, verificación separada, administración detallada de servicios,
detalle de tarea ni pantallas específicas de memberships, miembros, hitos o entregables.

## 5. Inventario de datos ficticios y acciones simuladas

| Archivo / líneas | Pantallas | Modelo o simulación | Reemplazo | Decisión |
| --- | --- | --- | --- | --- |
| `mock/seed.ts:38-49` | Login, layouts y toda relación de usuario | Usuarios internos/contactos e IDs `u*`/`c*u` | `/me`, memberships, project members y campos embebidos | Eliminar al integrar; adaptar identidad |
| `mock/seed.ts:52-57` | Clientes y portal | Empresas `cl*` | `/api/v1/organizations*` | Reemplazo con adaptación |
| `mock/seed.ts:60-66` | Público/prospectos/dashboard | Leads `p*`, fechas y estados | `/api/v1/leads*` | Reemplazo con adaptación |
| `mock/seed.ts:69-75` | Administración | Servicios `s*` | `/api/v1/services*` y `/admin/services*` | Reemplazo directo con mapeo de enum |
| `mock/seed.ts:78-128` | Proyectos y dashboards | Proyectos, hitos, entregables, avance | `/projects*`, `/milestones*`, `/deliverables*` | Reemplazo con adaptación; no inventar avance |
| `mock/seed.ts:131-140` | Tareas | Tareas, horas y relación directa a ticket | `/api/v1/tasks*` | Quitar `ticketId` y tiempo utilizado; convertir horas a minutos |
| `mock/seed.ts:143-183` | Tickets | Tickets/comentarios/resolución | `/api/v1/tickets*` | Reemplazo con adaptación |
| `mock/seed.ts:186-190` | Campana interna | Notificaciones | Ninguno | Ocultar hasta backend |
| `mock/seed.ts:193-197` | Auditoría | Eventos ficticios | Ninguno funcional | Ocultar hasta backend |
| `mock/seed.ts:215-218` | Login | Cuentas demo | Clerk + `/me` | Eliminar al cerrar integración |
| `store/AppStore.tsx:28-30` | Todas | IDs y fechas generados en navegador | IDs/timestamps server-owned | Eliminar |
| `store/AppStore.tsx:67-246` | Todas | Base de datos y mutaciones en `useState` | Query/cache + módulos API | Retirar por bloques, no de una vez |
| `store/AppStore.tsx:132-155` | Prospectos | Conversión crea empresa con campos “Por definir” | `POST /leads/:id/convert` | Rehacer UX; no copiar implementación |
| `store/AppStore.tsx:173-194` | Portal tickets | Código, responsable y requester hardcoded | `POST /tickets` | Eliminar |
| `Administracion.tsx:19-31` | Administración | Permisos y roles hardcoded | `/me.effectivePermissions`; no hay CRUD RBAC | Eliminar/ocultar matriz |
| `Portafolio.tsx:6-31`, `Home.tsx:128-149` | Público | Casos y métricas comerciales | Sin endpoint | Conservar estático solo tras validación editorial |
| `Planes.tsx:7-29` | Público | Precios/features | Sin endpoint | Conservar estático; retirar mención de SLA |
| `Servicios.tsx:8-37` | Público | Catálogo duplicado | `GET /services` | Sustituir por API; conservar copy complementario si es editorial |
| `Documentos.tsx:11-41` | Portal | Entregables presentados como archivos; descarga vacía | Ninguno | Ocultar ruta y navegación |

No se encontraron `setTimeout`, promesas simuladas, `sessionStorage`, almacenamiento de
negocio en `localStorage` ni formularios que impriman por consola. `localStorage` se usa
solo para el tema. Todos los formularios operativos mutan memoria y muestran éxito
inmediato; no contemplan red, cancelación ni conflicto.

## 6. Clerk y autorización

La integración existe pero no es segura todavía para el negocio:

- `ClerkProvider` y `SignIn` están instalados.
- `ClerkSessionBridge` busca `publicMetadata.appUserId` o correo dentro del seed y crea una
  sesión local.
- `RequireRole` confía en `session.usuario.tipo`.
- No se obtiene ni envía session token.
- No se consulta `/me`.
- No hay estado explícito de Clerk loading, usuario autenticado sin perfil local o sesión
  vencida.

Flujo recomendado:

1. Clerk autentica.
2. Un hook basado en `useAuth()` obtiene `getToken()` justo antes de la petición.
3. El cliente envía `Authorization: Bearer <session-token>` sin registrar ni persistir el token.
4. IlvoxB valida un `session_token`.
5. IlvoxB resuelve `clerk_user_id` a `app_users.id`.
6. PostgreSQL carga roles, permisos, memberships y scopes.
7. `/me` entrega perfil y capacidades visuales.
8. La UI oculta o deshabilita acciones por comodidad; el backend sigue siendo la autoridad.

Clerk Organizations no es requerido ni debe usarse para autorización del negocio. Metadata
de Clerk, rutas ocultas y filtros del navegador tampoco sustituyen RBAC/SQL. Un 404 puede
significar inexistente o fuera de scope. Ante 409 se debe invalidar/refetch, preservar la
entrada del usuario y explicar el conflicto.

## 7. Cliente HTTP y variables de entorno

No existe cliente HTTP. La propuesta debe manejar JSON `{ data }`, errores `{ error }`,
Bearer, timeout con `AbortController`, cancelación al desmontar, request ID, 401/403/404/
409/413/429, red, paginación y filtros.

Frontend actual:

- variable usada: `VITE_CLERK_PUBLISHABLE_KEY`;
- `VITE_API_BASE_URL` no existe;
- no hay `.env.example`;
- no hay archivos `.env*` presentes;
- `.gitignore` cubre `.env`, variantes locales, `dist` y `node_modules`.

Backend declara estas variables (solo nombres):

`NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`, `TRUST_PROXY`, `CORS_ORIGINS`,
`BODY_LIMIT_BYTES`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW`, `DATABASE_URL`,
`TEST_DATABASE_URL`, `DATABASE_POOL_MAX`, `DATABASE_IDLE_TIMEOUT_MS`,
`DATABASE_CONNECTION_TIMEOUT_MS`, `CLERK_AUTH_ENABLED`, `CLERK_WEBHOOKS_ENABLED`,
`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`,
`CLERK_AUTHORIZED_PARTIES`, `CLERK_AUDIENCE`.

Puertos: Vite no configura uno, por lo que usa `5173`; Fastify usa `3001`. El runtime
observado acepta CORS para `http://127.0.0.1:5173`; una petición con origen
`http://localhost:5173` no recibió `Access-Control-Allow-Origin`. El valor fuente por
defecto es `http://localhost:5173`, por lo que entorno efectivo y default divergen.

Se recomienda estandarizar desarrollo en `127.0.0.1`: origen frontend
`http://127.0.0.1:5173` y base de API `http://127.0.0.1:3001`. Como las rutas funcionales
usan `/api/v1` pero `/me` es histórica y vive en raíz, `VITE_API_BASE_URL` debe representar
el origen del backend y cada módulo añadir `/api/v1` donde corresponda.

Toda variable `VITE_*` queda visible en el navegador. Solo puede contener valores públicos;
nunca secretos Clerk, contraseñas, DSN ni tokens.

## 8. Backend real para integración

- Runtime observado: live 200, ready 200 y base de datos `up`.
- OpenAPI local: 3.1.0, versión API `0.6.0`, 36 paths y 55 operaciones.
- Las 55 operaciones usan server `/api/v1`.
- Excepciones históricas: `/health/live`, `/health/ready`, `/me` y webhook Clerk.
- `GET /api/v1/services` respondió 200 con paginación válida y catálogo vacío.
- `/me` sin token respondió 401 en el envelope documentado.
- Éxito: `{ "data": ... }`.
- Lista: `{ "data": { "items": [], "pagination": { "page", "pageSize", "total", "totalPages" } } }`.
- Error: `{ "error": { "code", "message", "requestId", "details"? } }`.
- IDs: UUID. Instantes: ISO 8601 UTC. Fechas de negocio: `YYYY-MM-DD`.
- Paginación: página 1, `pageSize` 1–100, default 20.
- Búsqueda, filtros y orden existen por módulo; no hay orden arbitrario.
- Body global default: 1 MiB.
- Rate limit global default: 100/minuto; leads públicos: 10/minuto.
- Concurrencia: `expectedUpdatedAt` opcional en las mutaciones que lo declaran; transiciones
  también validan estado bajo lock.
- Códigos relevantes: 200, 201, 400, 401, 403, 404, 409, 413, 429, 500 y 503 de readiness.

## 9. Diferencias de tipos y contratos

| Concepto | Frontend | Backend | Adaptación |
| --- | --- | --- | --- |
| Usuario | `nombre`, `correo`, `imagen`, `tipo`, `rol`, `clienteId` | `/me.user`, `roles[]`, `organizations[]`, `effectivePermissions[]` | No reducir a un rol ni una empresa |
| Cliente | `nombreComercial`, `razonSocial`, `nit`, `sector`, `tamano`, `responsableId` | organization: `name`, `legalName`, `taxId` + `countryCode`, `industry`, `size`, `accountManagerUserId` | Renombrar, mapear tamaños y nullables |
| Lead | `servicioInteres` es categoría | `serviceId` UUID nullable | Cargar catálogo y enviar ID |
| Fuente lead | `diagnostico`, `cotizacion`, `contacto`, `referencia`, `campana` | `diagnostic`, `quotation`, `contact`, `referral`, `campaign` | Mapa explícito |
| Servicio | categorías en español técnico | `development`, `ecommerce`, `digital_presence`, `automation`, `support` | Mapa explícito |
| Proyecto | `clienteId`, `responsableId`, `equipoIds`, `fechaFin`, `avance` | `organizationId`, `leadUserId`, members separados, `dueDate`; sin `avance` | Componer recursos; no inventar avance |
| Hito | embebido | recurso separado, descripción nullable y timestamps | Consultar por proyecto |
| Entregable | booleano `aprobado` | `pending/in_review/delivered/approved/rejected` | Reemplazar booleano |
| Tarea | `responsableId`, horas, `tiempoUtilizado`, `ticketId` | `assignedToUserId`, `estimatedMinutes`; sin tiempo utilizado ni ticket | Convertir unidades; retirar campos |
| Ticket | `clienteId`, `solicitanteId`, `responsableId`, `asunto` | `organizationId`, `requesterUserId` server-owned, `assignedToUserId`, `subject` | No enviar requester ni assignee implícito |
| Prioridad ticket | una `prioridad` | `requestedPriority` y `priority` operativa | Mostrar ambas donde corresponda |
| Comentario | `autorId`, `contenido`, `visibilidad`, `fecha` | `authorUserId`, `content`, `visibility`, `createdAt` | Mapa y carga separada |
| Nullables | Muchos opcionales | Null explícito en records | Normalizar `undefined`/`null` |
| Concurrencia | Inexistente | `updatedAt` + `expectedUpdatedAt` | Conservar versión observada |

Los estados usan inglés en backend. Los mapas deben ser exhaustivos y separados de las
etiquetas visuales. Destacan `ready` ↔ `por_iniciar`, `cancelled` ↔ `cancelado`,
`bug` ↔ `error` y `digital_presence` ↔ `presencia`.

No se recomienda generar código todavía: el OpenAPI es valioso para verificación, pero las
respuestas de dominio no están descritas con suficiente precisión en todos los paths. En
7.1 conviene crear tipos adaptadores manuales y contract tests; reevaluar generación tras
completar schemas de respuesta.

## 10. Estados UX

| Módulo | Loading/skeleton | Empty | Red/validación | Auth/scope | 409/429/retry | Éxito/confirmación |
| --- | --- | --- | --- | --- | --- | --- |
| Público servicios | No | No | No | N/A | No | N/A |
| Leads públicos | No | Solo “enviado” | Validación manual | N/A | No | Toast; sin pending/doble submit |
| Autenticación | Loading Clerk no explícito | N/A | Clerk o demo | No trata perfil local ausente | No | Logout sí |
| Organizaciones | No | Parcial | No | Filtros navegador | No | Solo lectura |
| Proyectos | No | Parcial | No | Filtros navegador | No | Solo lectura |
| Tareas | No | No | Manual mínima | Sin permisos visuales | No | Toast; drag sin confirmación |
| Tickets internos | No | Comentarios sí | Manual mínima | Sin permisos visuales | No | Toast; resolver con diálogo |
| Tickets cliente | No | Sí | Manual mínima | Redirect/filtro local | No | Toast; confirmar sin diálogo; faltan rechazo/reapertura |
| Documentos | No | Sí | No | Filtro local | No | Botón de descarga sin acción |
| Administración/auditoría | No | No | No | Matriz hardcoded | No | Solo lectura mock |

Debe distinguirse: 401 (sesión), 403 (acción prohibida), 404 (inexistente o fuera de scope,
sin revelar cuál), 409 (refetch y conflicto), 413 (payload), 429 (espera/retry controlado) y
fallo de red. No hay actualización optimista que deba conservarse; puede añadirse solo
después de que invalidación y rollback estén probados.

## 11. Dependencias

| Dependencia/capacidad | Estado | Decisión |
| --- | --- | --- |
| Clerk React | Disponible | Usar |
| React Router | Disponible | Usar |
| React Hook Form | Disponible | Usar gradualmente en formularios |
| Sonner | Disponible | Usar con mensajes derivados del error normalizado |
| Recharts | Disponible | Conservar; no convierte métricas ficticias en reales |
| Tabla | Primitive local disponible | Suficiente; no añadir librería aún |
| TanStack Query | Ausente | **Necesaria** para cache, deduplicación, invalidación, loading y cancelación |
| Axios | Ausente | Innecesaria; `fetch` cubre Bearer, JSON y AbortController |
| Zod | Ausente | Opcional; útil para formularios, pero evitar duplicar TypeBox/OpenAPI sin estrategia |
| i18n | Ausente | Opcional y fuera del mínimo de Fase 7 |
| MUI/Emotion | Disponible pero sin uso | Evitar para no mantener dos sistemas UI |
| Generador OpenAPI | Ausente | Opcional después de mejorar schemas de respuesta |

## 12. Funciones a ocultar y contenido a conservar

Ocultar temporalmente: `/portal/documentos`, descarga/subida, notificaciones, auditoría,
CRUD de usuarios/roles/permisos, tareas derivadas de tickets, cualquier SLA operativo,
facturación, invitaciones externas, chat y métricas empresariales presentadas como
definitivas.

Conservar estático: landing, nosotros, proceso, FAQ, copy comercial, modalidades de
contratación y portafolio, sujeto a revisión editorial. El catálogo público debe pasar a
API; el contenido explicativo puede permanecer estático.

## 13. Riesgos y condiciones de inicio

Condiciones para 7.1:

1. Unificar origen Vite, CORS y `CLERK_AUTHORIZED_PARTIES`.
2. Sustituir el bridge de metadata/seed por token + `/me`.
3. Definir el tratamiento de `/me` fuera de `/api/v1`.
4. Corregir el typecheck preexistente del frontend.
5. Añadir `.env.example` frontend sin secretos.
6. Diseñar empty state real: el catálogo backend está vacío.
7. Mantener ocultas las capacidades sin endpoint.
8. Aplicar scopes desde respuesta/backend, nunca reconstruirlos desde el router.

Riesgos de seguridad principales: autorización en navegador, metadata Clerk como rol,
IDs de tenant enviados por la UI, filtrado de comentarios internos en cliente, redirects
como “seguridad” y matriz RBAC hardcoded.

Riesgos UX principales: ausencia total de loading/red/retry, éxito antes de persistencia,
transiciones inválidas por drag/select, falta de paginación remota, 404 ambiguo mal
explicado, 409 no tratado y botones de funcionalidades inexistentes.

## 14. Estado Git final y control de cambios

| Proyecto | Rama | HEAD final | Working tree final |
| --- | --- | --- | --- |
| IlvoxF | `dev` | `99136a843016df6449c21ac06e970f8243f97a65` | Solo el `package-lock.json` preexistente sigue modificado |
| IlvoxB | `main` | `1fdcac2e20cff5bd4ebacd162460c53b0e274afb` | Los tres documentos de Fase 7.0 nuevos y `phase-7-readiness.md` modificado |

El HEAD de IlvoxB cambió externamente durante la auditoría desde `a0dbbe2...` al commit
`1fdcac2...` (`Fase 6.0 Finiished fix and test`). Esta ejecución no creó ese commit ni
ejecutó stage, commit o push.

Confirmaciones:

- cero modificaciones funcionales en IlvoxF o IlvoxB;
- cero cambios de PostgreSQL, Clerk, migraciones, OpenAPI o variables de entorno;
- cero instalaciones;
- cero stage, commit y push ejecutados por esta auditoría;
- únicas escrituras: los tres documentos solicitados y la actualización necesaria de
  readiness para definir Fase 7 como integración IlvoxF ↔ IlvoxB.
