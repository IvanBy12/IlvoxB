# API de Fase 4.5

Base: `/api/v1`. OpenAPI: `docs/openapi.json`.

| Método | Ruta | Regla |
| --- | --- | --- |
| GET | `/services` | Público; solo activo+visible |
| GET | `/services/:serviceId` | Público; solo activo+visible |
| GET | `/admin/services` | `services.read` global |
| GET | `/admin/services/:serviceId` | `services.read` global |
| POST | `/admin/services` | `services.manage`, interno |
| PATCH | `/admin/services/:serviceId` | `services.manage`, interno |
| POST | `/leads` | Público; backend fuerza `new` |
| GET/PATCH | `/leads`, `/leads/:leadId` | `leads.read/manage`, global o assigned |
| POST | `/leads/:leadId/transition` | `leads.manage` |
| POST | `/leads/:leadId/assign` | `leads.manage` |
| POST | `/leads/:leadId/convert` | Permiso según modalidad |
| GET/POST/PATCH | `/organizations...` | Módulo opcional, permisos existentes |
| GET/POST/PATCH | `/organizations/:id/members...` | Módulo opcional |

Conversión standalone requiere solo `leads.manage`. Crear o reutilizar organización requiere
además `organizations.manage`. Ninguna modalidad crea contactos o identidad Clerk.

OpenAPI contiene exactamente **20 operaciones**. No incluye rutas de contactos, eliminación
física ni edición de perfil por `client_manager`.
