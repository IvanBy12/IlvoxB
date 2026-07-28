# Fase 7.2 — Implementación del módulo público

Fecha: 27 de julio de 2026  
Alcance: catálogo/detalle de servicios y captura pública de leads.

## Contratos confirmados

| Operación | Contrato |
| --- | --- |
| `GET /api/v1/services` | público; page ≥1, pageSize 1–100, search 1–160, category enum; solo `is_public=true AND is_active=true` |
| `GET /api/v1/services/:serviceId` | UUID; 200 o 404; solo publicado/activo |
| `POST /api/v1/leads` | público; 201; 10/min; body global 1 MiB |

Servicios devuelven id, nombre, categoría, descripción, flags y timestamps. Las
categorías son `development`, `ecommerce`, `digital_presence`, `automation` y
`support`.

Leads requieren `fullName` (1–160), `email` (máx. 320), `message` (1–5000) y
source. `companyName` (1–200), `phone` (1–40) y `serviceId` UUID son opcionales.
Status/asignación/conversión se rechazan. No existe 409 para la captura pública.

## Frontend

- Cliente público lazy con token provider siempre nulo.
- `services.api.ts` y `leads.api.ts` reutilizan el cliente HTTP 7.1.
- Tipos de API, modelos visuales, adaptadores y etiquetas quedan separados.
- Categorías desconocidas muestran “Otra categoría” y solo generan un warning
  genérico en desarrollo.
- `/servicios` incorpora loading, vacío, error, retry, filtro y paginación.
- `/servicios/:serviceId` usa texto plano, 404 neutral y CTA con UUID.
- `LeadForm` usa React Hook Form, source explícito, selector real opcional,
  validación TypeBox-equivalente, foco, ARIA, lock de submit y mutación sin
  retry.
- 201 limpia; errores conservan datos. 429 respeta `Retry-After`.
- Las rutas públicas ya no usan `crearProspecto`, servicios seed ni categorías
  locales como IDs.

## Correcciones backend objetivas

El rate limiter devolvía 500 porque su builder lanzaba un objeto que el handler
global no reconocía. Se cambió únicamente a `AppError` con status 429.
Adicionalmente CORS expone `Retry-After` y `X-Request-Id` al origen canónico.
No cambiaron el límite, OpenAPI, tablas, migraciones, RBAC ni endpoints.

## Límites

No se conectaron leads internos, administración de servicios, portal,
organizaciones, proyectos, hitos, entregables, tareas, tickets o comentarios.
AppStore y seed continúan solo para módulos posteriores. Fase 7.3 no inició.
