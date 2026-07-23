# Convenciones HTTP

Fecha de corte: 23 de julio de 2026.

## Prefijos y formato

- Las rutas funcionales nuevas usan `/api/v1`.
- Salud, identidad y webhook conservan sus rutas históricas.
- Éxito: `{ "data": ... }`.
- Error: `{ "error": { "code", "message", "requestId", "details"? } }`.
- IDs son UUID.
- Fechas y horas se representan como ISO 8601 UTC.
- Los listados devuelven `items` y `pagination` con `page`, `pageSize`, `total` y
  `totalPages`.

## Paginación, búsqueda y orden

- `page` inicia en 1.
- `pageSize` admite 1–100; por defecto 20.
- Los conteos usan exactamente el mismo filtro de scope que los datos.
- Solo se aceptan campos de orden explícitamente enumerados.
- Todo orden incluye `id` como desempate estable.

## Autenticación y autorización

- Las rutas públicas del catálogo y `POST /api/v1/leads` no requieren Clerk.
- Las rutas internas requieren sesión Clerk válida, perfil local `active`, permiso real y
  scope resuelto por `AuthorizationService`.
- Un 404 puede representar inexistencia o recurso fuera de scope para no revelar existencia.
- Un PATCH genérico de lead no acepta estado, asignación ni conversión.

## Errores relevantes

| HTTP | Código | Uso |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body/query inválido o usuario no elegible |
| 401 | `UNAUTHENTICATED` | Sesión ausente o inválida |
| 403 | `FORBIDDEN` | Permiso o scope no concedido |
| 404 | `NOT_FOUND` | Inexistente o fuera de scope |
| 409 | `CONFLICT` | Transición, duplicado o concurrencia |
| 413 | `PAYLOAD_TOO_LARGE` | Límite global de body |
| 429 | `RATE_LIMITED` | Límite global o captación pública |

## Idempotencia

La captación no deduplica por correo: dos solicitudes legítimas pueden compartirlo.
La conversión es idempotente por el estado y vínculo persistidos del lead bajo lock. Una
repetición con una organización o identidad empresarial incompatible devuelve conflicto.
No se afirma idempotencia general por header porque el esquema no almacena una clave.
