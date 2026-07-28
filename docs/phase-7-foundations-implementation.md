# Fase 7.1 — Implementación de fundaciones frontend/backend

Fecha: 27 de julio de 2026  
Alcance: transporte HTTP, token Clerk, identidad `/me`, caché remota, errores,
guards, gates y configuración local.  
Estado: **implementado; sin iniciar Fase 7.2**.

## Estado inicial preservado

| Repositorio | Rama / HEAD auditado | Cambios previos preservados |
| --- | --- | --- |
| IlvoxF | `dev` / `99136a843016df6449c21ac06e970f8243f97a65` | `package-lock.json` ya tenía dos cambios de nombre `@figma/my-make-file` → `ilvox` |
| IlvoxB | `main` / `1fdcac2e20cff5bd4ebacd162460c53b0e274afb` | tres documentos nuevos de Fase 7.0 y `phase-7-readiness.md` modificado |

No se ejecutaron pull, merge, rebase, reset, checkout destructivo, stage, commit ni
push. No se modificaron migraciones, OpenAPI, PostgreSQL, Clerk Organizations,
roles, permisos ni endpoints.

`npm install @tanstack/react-query` se ejecutó como única instalación. El diff
previo del lockfile se capturó antes de instalar y sus dos líneas se restauraron
después de la normalización de npm. También se restauró la entrada extraneous de
`yaml` que npm había retirado como efecto mecánico; el diff propio del lock queda
limitado a TanStack Query y Query Core.

## Configuración local canónica

| Elemento | Valor |
| --- | --- |
| Frontend Vite | `http://127.0.0.1:5173` |
| Backend | `http://127.0.0.1:3001` |
| `VITE_API_BASE_URL` | origen backend, sin `/api/v1` |
| `CORS_ORIGINS` | `http://127.0.0.1:5173` |
| `CLERK_AUTHORIZED_PARTIES` | `http://127.0.0.1:5173` |

IlvoxF incorpora `.env.example` solo con variables públicas. Vite fija host,
puerto y `strictPort`. IlvoxB alinea el default tipado, `.env.example`, el entorno
local efectivo y el helper de tests. No se leyó, imprimió, copió ni modificó
ningún secreto.

## Cliente HTTP

Se creó `src/app/api/` con:

- `api-client.ts`: `fetch`, URL base validada, query params repetidos para
  arrays, token provider inyectado, `AbortSignal`, timeout, JSON estricto,
  `credentials: omit` y `redirect: error`;
- `api-error.ts`: error normalizado con `status`, `code`, `message`,
  `requestId`, `details`, `isNetworkError`, `isTimeout` e `isAborted`;
- `api-paths.ts`: rutas explícitas; `/me` se mantiene fuera de `/api/v1`;
- `api-types.ts`: contrato completo de user, organizations, roles,
  effectivePermissions, `scopeOrganizationIds` y capabilities;
- `query-client.ts`: cache central sin persistencia, stale/gc acotados, dos
  reintentos como máximo solo para queries y cero retry de mutaciones;
- `modules/identity.api.ts`: único módulo funcional de esta fase, `GET /me`.

El cliente obtiene un token fresco justo antes de cada request, añade
`Authorization: Bearer …`, no registra ni persiste el token y desenvuelve
`{ data }`. Los errores `{ error }` conservan el request ID. 401, 403, 404, 409
y 413 no se reintentan; red, timeout, 429 y 5xx pueden reintentarse de forma
acotada en queries. Una cancelación del consumidor nunca se presenta como
timeout.

## Identidad, caché y logout

`ClerkSessionBridge` y la búsqueda por `publicMetadata.appUserId`/correo fueron
eliminados. El flujo nuevo es:

1. Clerk resuelve loading/signed-out/signed-in.
2. `useApiToken` obtiene el session token.
3. TanStack Query consulta `/me`.
4. Un perfil local activo produce estado `ready`.
5. Un 403 produce “Acceso no habilitado”.
6. Un error transitorio permite retry.
7. Un 401 cancela/limpia cache y fuerza sign-out.

El logout cancela queries, limpia por completo `QueryClient` y ejecuta
`Clerk.signOut`. Un cambio de `userId` limpia la misma caché antes de volver a
consultar identidad. No hay persistencia de cache ni tokens.

`AppStore` y `mock/seed.ts` permanecen temporalmente para vistas de negocio no
migradas, como exigía el alcance, pero `AppStore` ya no expone `session`,
`login` ni `logout`; no autentica, no autoriza y no recibe un usuario seed desde
la identidad real.

## Guards, permisos y rutas

`ProtectedRoute` fue extraído de `App.tsx`. La política es:

- identidad interna → `/app`;
- identidad con membresía cliente → `/portal`;
- ambas → landing `/app`, conservando deep links autorizados al portal;
- ninguna → acceso no habilitado;
- signed-out → `/login` preservando un deep link local;
- origen externo o deep link no autorizado → landing permitida.

`PermissionGate` usa exclusivamente códigos de `effectivePermissions`, soporta
`one`, `any`, `all`, fallback, ocultar y deshabilitar. No interpreta roles,
capabilities, URLs ni scopes como grants adicionales; el backend continúa como
autoridad final.

Se añadieron estados reutilizables de loading, empty, error y configuración
faltante. La semántica visual distingue 401, 403, 404, 409, 413, 429, red,
timeout y aborto.

Se retiraron navegación y rutas de documentos/descargas, notificaciones,
auditoría y administración/RBAC. Una URL directa cae en una página 404 neutral,
sin datos mock. Los dashboards dejaron de mostrar KPIs ficticios y explican que
las métricas permanecen ocultas hasta tener consultas backend.

## Autenticación no configurada

El selector de cuentas demo fue eliminado. Si falta la Publishable Key o la base
de API, el login y las rutas protegidas muestran “Configuración de acceso
incompleta”. No existe flag de desarrollo habilitado por defecto ni sesión
autorizada simulada.

## Correcciones preexistentes y scripts

- `src/vite-env.d.ts` declara `vite/client` y las dos variables públicas.
- `tsconfig.check.json` incluye esa declaración.
- `Logo.tsx` usa el asset real mediante `@/imports/image.png`.
- IlvoxF añade `typecheck`, `test` y `check`.
- No se añadió ESLint: no existía en el repositorio y el alcance autorizó
  instalar únicamente TanStack Query.

## Límites conservados

No se conectaron leads, services, organizations, projects, milestones,
deliverables, tasks, tickets ni comments. No se implementaron archivos, tareas
de ticket, notificaciones, auditoría, administración RBAC, SLA, facturación,
invitaciones, chat ni métricas definitivas. No se inició Fase 7.2.

## Cierre operativo autenticado

Se completó el smoke final con la única cuenta real de la instancia Clerk de
desarrollo. El perfil local fue localizado exclusivamente por
`app_users.clerk_user_id`; no se usaron metadata, email ni Clerk Organizations
para autorizar.

El primer acceso autenticado encontró el perfil sincronizado por webhook en
estado `pending` y `/me` respondió 403, mostrando “Acceso no habilitado”. Con
autorización expresa se creó un fixture PostgreSQL transaccional y mínimo:
activación temporal del mismo perfil, rol global `contributor`, una organización
temporal activa y membership `client_contact`. No se insertó manualmente ningún
`app_user`.

Con el fixture activo se comprobaron `/me` 200, redirect dual determinista a
`/app`, deep links internos y de portal, `PermissionGate` positivo con
`tickets.create`, recuperación ante backend no disponible, logout, protección
signed-out y reautenticación con una nueva llamada a `/me`. Al terminar se
eliminaron exactamente la organización, membership y rol temporales, y el
perfil volvió a `pending`; las verificaciones finales dieron 0/0/0/1.

La evidencia detallada está en `phase-7-authenticated-smoke.md`. Este cierre no
añadió endpoints, migraciones, módulos de negocio ni inició Fase 7.2.
