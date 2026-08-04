# Fase 7.5A — área interna: servicios y organizaciones

Fecha: 4 de agosto de 2026.

## Decisión

Se implementaron exclusivamente los bloques 1 y 2 autorizados de Fase 7.5:
administración de servicios y organizaciones/clientes con memberships locales existentes.
No se inició ningún trabajo de proyectos, tareas, prospectos, tickets internos o Personal.

## Contratos utilizados

| Capacidad | Contrato | Permiso visual | Autoridad final |
| --- | --- | --- | --- |
| Listar/filtrar servicios | `GET /api/v1/admin/services` | `services.read` | Backend + PostgreSQL |
| Detalle de servicio | `GET /api/v1/admin/services/:serviceId` | `services.read` | Backend + PostgreSQL |
| Crear servicio | `POST /api/v1/admin/services` | `services.manage` | Backend + PostgreSQL |
| Editar/activar/publicar/ocultar | `PATCH /api/v1/admin/services/:serviceId` | `services.manage` | Backend + PostgreSQL |
| Listar organizaciones | `GET /api/v1/organizations` | `organizations.read` | Backend + PostgreSQL |
| Crear organización | `POST /api/v1/organizations` | `organizations.manage` | Backend + PostgreSQL |
| Detalle de organización | `GET /api/v1/organizations/:organizationId` | `organizations.read` | Backend + PostgreSQL |
| Editar organización | `PATCH /api/v1/organizations/:organizationId` | `organizations.manage` | Backend + PostgreSQL |
| Listar memberships | `GET /api/v1/organizations/:organizationId/members` | `organizations.read` | Backend + PostgreSQL |
| Editar/activar/revocar membership | `PATCH /api/v1/organizations/:organizationId/members/:memberId` | `organization_members.manage` | Backend + PostgreSQL |

Los contratos de servicios y organizaciones no aceptan `expectedUpdatedAt`; por ello no se
envía un campo inexistente. Un 409 preserva el formulario, actualiza la consulta remota y
explica el conflicto. Las mutaciones tienen `retry: false` y locks de submit además del
estado pending.

## Servicios administrativos

`/app/administracion` ahora es exclusivamente administración del catálogo. La navegación
se muestra mediante `PermissionGate` con `services.read`; crear y mutar exige visualmente
`services.manage`. Usuarios, roles, permisos, RBAC y auditoría fueron retirados de esa
pantalla y siguen ocultos.

La pantalla usa TanStack Query, token fresco y el cliente HTTP central para búsqueda,
categoría, visibilidad, actividad y paginación del servidor. El detalle se consulta antes
de editar. Crear, editar, activar/desactivar y publicar/ocultar invalidan tanto la cache
interna como el catálogo público.

## Organizaciones/clientes

`/app/clientes` adapta el término visual “cliente” al recurso backend `organization`.
Listado, búsqueda, estado y paginación son remotos; no hay conteos ni métricas ficticias.
El alta respeta la pareja `countryCode`/`taxId` y no envía responsable inventado.

`/app/clientes/:id` consulta detalle y memberships de forma independiente. Permite editar
los campos reales de organización y muestra como estado neutral “Recurso no disponible”
para UUID inválido o una respuesta 403/404 del detalle. El backend sigue decidiendo scope;
el frontend no implementa filtros de tenant.

## Memberships y brecha de usuarios

Los contactos visuales son memberships locales existentes; no se creó otro modelo. Se
implementó edición de rol cliente, estado, cargo y teléfono, además de revocación con
confirmación explícita. Una membership revocada permanece en el listado para auditoría.

Crear membership se mantiene deshabilitado y explicado. El contrato exige un `userId`,
pero no existe un catálogo general seguro de candidatos. No se consulta Clerk desde el
navegador, no se usan usuarios seed, no se inventan IDs y no se implementó Personal. La
asignación de `accountManagerUserId` queda diferida por la misma razón.

## UX y errores

Las vistas incluyen loading, empty, error, retry manual, tablas con scroll responsive,
formularios etiquetados, pending, bloqueo de doble submit y mensajes para 401, 403, 404,
409, 413, 429, red y timeout. Los errores incluyen `requestId` cuando el backend lo
proporciona. Las acciones rápidas de servicio también conservan retry manual.

## Mocks retirados y límites

`Administracion.tsx`, `Clientes.tsx` y `ClienteDetalle.tsx` ya no importan `AppStore`,
`seed.ts` ni usuarios mock. `AppStore` y el seed no se eliminaron porque otros módulos
internos todavía dependen de ellos. No se modificaron tablas, migraciones, OpenAPI o RBAC.

Fase 7.5B no fue iniciada.
