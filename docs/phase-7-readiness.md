# Readiness para Fase 7 — Integración IlvoxF ↔ IlvoxB

Fecha de actualización: 4 de agosto de 2026.

## Estado por bloque

| Bloque | Estado |
| --- | --- |
| Fase 7.0 — auditoría/plan | Completada |
| Fase 7.1 — fundaciones | Implementada y validada localmente |
| Fase 7.2 — módulo público | Implementada y validada localmente |
| Fase 7.3 — autenticación privada por invitación | Implementada; cierre condicionado a smoke con correo invitado |
| Fase 7.4 — portal cliente | Implementada y validada |
| Fase 7.5A — servicios y organizaciones internas | Implementada y validada |
| Fase 7.5B — resto del área interna | No iniciada |

Fase 7.1 implementó exclusivamente transporte HTTP, token Clerk, `/me`, cache,
errores, guards/gates, logout, cambio de usuario, origen/CORS y correcciones de
typecheck. La evidencia se encuentra en:

- `phase-7-foundations-implementation.md`;
- `phase-7-foundations-test-results.md`;
- `phase-7-authenticated-smoke.md`;
- `phase-7-integration-matrix.md`;
- `phase-7-implementation-plan.md`.

## Gate hacia el siguiente bloque

Typecheck, tests y builds pasan; el backend vivo respondió health 200/200,
rechazó `/me` sin token, cumplió CORS positivo/negativo/preflight para el origen
canónico y completó `/me` 200 con una sesión Clerk real y un perfil local activo
temporal.

El smoke autenticado verificó redirect, deep links, permisos, perfil inactivo,
backend no disponible, retry, logout, reautenticación y rutas ocultas. El
fixture PostgreSQL autorizado fue retirado por completo y el perfil quedó otra
vez en `pending`. No se inspeccionó ni persistió ningún token.

**Decisión histórica de 7.1:** ese cierre habilitó la ejecución autorizada de
Fase 7.2. Permanece pendiente una revisión separada de los advisories npm
(1 moderado y 2 altos).

## Gate de Fase 7.2

El catálogo y detalle consumen servicios reales sin bearer. Contacto,
diagnóstico y cotización crean leads reales con source explícito, UUID opcional,
POST sin retry y estados accesibles. El smoke confirmó catálogo vacío, servicio
publicado temporal, tres sources persistidos, 400/404/429, 20 combinaciones
responsive y residuo cero.

Durante las pruebas se corrigió una brecha objetiva: el rate limiter lanzaba un
objeto no reconocido por el error handler y convertía 429 en 500. Ahora lanza
`AppError` 429 y CORS expone `Retry-After`. OpenAPI y límites no cambiaron.

Los gates integrales pasaron: frontend 17/17 más typecheck y build; backend
107/107, lint, auditoría de constraints y build. El runtime respondió
`live`/`ready` 200, `/me` sin token 401 y catálogo público 200 vacío después de
la limpieza. El bundle de producción no contiene patrones de secretos.

**Decisión:** Fase 7.2 está técnicamente cerrada y lista para que el propietario
decida si autoriza Fase 7.3. Esta implementación no inicia ni autoriza Fase 7.3.

## Gate de Fase 7.3

La instancia Clerk de desarrollo Hobby quedó en `Restricted mode`. El login
efectivo ofrece email con contraseña; el código por email está habilitado en
Clerk y no existen conexiones sociales ni SSO. El signup público desapareció
de la UI y las rutas `/signup`, `/login/sign-up` y equivalentes devuelven 404.
No se habilitó allowlist, producción ni ninguna capacidad Pro.

La aceptación usa el ticket oficial `__clerk_ticket` y no permite elegir role,
organización, status, permisos o metadata. `/me` ahora devuelve códigos
distintos para perfil no sincronizado, pendiente e inactivo. El frontend
reintenta de forma acotada únicamente la consistencia eventual, preserva deep
links locales y limpia cache al cerrar sesión o cambiar de usuario.

Los gates finales pasaron: frontend 21/21 más typecheck y build; backend
107/107, lint, auditoría de constraints y build. Las pruebas focalizadas de
`/me`, firma de webhook y PostgreSQL aislado pasaron 21/21. El runtime respondió
`live`/`ready` 200, catálogo público 200 y `/me` sin credenciales 401.

**Decisión:** Fase 7.3 queda **aprobada con condiciones**. Antes de producción
falta ejecutar un smoke completo con un correo invitado controlado y confirmar
la entrega remota del webhook desde Clerk hacia una URL pública. Estas son
condiciones externas de operación; no requieren plan Pro ni autorizan iniciar
Fase 7.4.

## Límites vigentes

Fase 7 no autoriza todavía archivos, tareas derivadas de tickets,
notificaciones, auditoría funcional, CRUD de usuarios/roles/permisos, SLA,
facturación, contactos empresariales independientes, invitaciones de negocio,
chat ni métricas empresariales definitivas. Esas capacidades permanecen
ocultas.

`AppStore` y el seed sobreviven solo como transición para módulos internos y de
portal aún no migrados. Ya no son autoridad de autenticación, permisos,
servicios públicos ni captura pública de leads. No se inició Fase 7.4.

## Gate de Fase 7.4

El portal del cliente consume contratos reales para organizaciones, proyectos,
hitos, entregables, tickets, comentarios y resolución. El scope proviene de
`/me`, no de URL, correo, metadata o Clerk Organizations. Cambio de contexto,
logout y cambio de usuario cancelan y eliminan cache dependiente.

El smoke HTTP/PostgreSQL usó dos organizaciones y fixtures
`PHASE74_SMOKE_`. Probó aislamiento, 404 neutral, tres contextos de ticket,
comentarios internos ocultos, confirmar, rechazar, reabrir, 409 y
`residualFixtures: 0`.

Se corrigieron dos defectos backend encontrados por el smoke: scope
`projects.read` incompatible para `client_contact`, e inclusión interna para
clientes con un grant de proyecto. No cambiaron OpenAPI, tablas, migraciones o
RBAC persistido.

El portal no consulta comentarios para identidades duales: el endpoint es
compartido con el área interna y no existe un discriminador de superficie en el
contrato. Esta defensa evita que contenido interno llegue a `/portal` sin
inventar una operación nueva.

Los componentes mock migrados fueron retirados; `AppStore` y `seed.ts`
permanecen solo para el área interna. Las capacidades fuera de alcance siguen
ocultas. Fase 7.5 no fue iniciada.

La decisión final y los resultados exactos de gates se registran en
`phase-7-client-portal-test-results.md`.

## Gate de Fase 7.5A

Servicios administrativos y organizaciones/clientes internos consumen contratos reales.
Las tres pantallas migradas dejaron de importar `AppStore` y seed. Usuarios, roles,
permisos, auditoría y Personal permanecen ocultos.

El gate frontend aprobó typecheck, 47 pruebas y build; el gate backend aprobó typecheck,
lint, 120 pruebas, 6 auditorías de constraints y build. El runtime respondió live/ready
200, `/me` sin token 401 y catálogo público 200.

El smoke HTTP/PostgreSQL `PHASE75A_SMOKE_` cubrió servicios, dos organizaciones,
memberships existentes, revocación, 403, 404, 409, visibilidad pública e aislamiento. El
backend niega el UUID cross-tenant con 403 antes de consultar el repositorio; el detalle
frontend lo presenta neutralmente como “Recurso no disponible”. La limpieza reportó
`residualFixtures: 0`.

No existe catálogo general seguro de usuarios asignables. Por ello añadir memberships y
editar `accountManagerUserId` siguen diferidos y explicados, sin bloquear el resto. No se
modificaron migraciones, tablas, OpenAPI o RBAC y no se ejecutaron operaciones Git de
escritura.

**Decisión:** Fase 7.5A queda técnicamente cerrada. Fase 7.5B no fue iniciada ni queda
autorizada implícitamente por este cierre.
