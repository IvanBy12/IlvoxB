# Fase 4.5 — organizaciones opcionales

Fecha: 23 de julio de 2026.

## Decisión de producto

El MVP funciona con usuarios internos activos, roles globales, Clerk, servicios, leads y
trabajo operativo interno. Una organización, membresía, contacto empresarial, organización
Clerk o rol organizacional no es un prerrequisito transversal.

Las rutas organizacionales existentes permanecen como capacidad opcional y compatible. No
se añadieron contactos, invitaciones, permisos de contactos ni edición de perfil por
`client_manager`.

## Obligatoriedad estructural actual

| Entidad | Columna | Nullable actual | Uso | Puede operar sin organización | Cambio requerido |
| --- | --- | ---: | --- | ---: | --- |
| Lead | `converted_organization_id` | Sí | Organización creada o reutilizada al convertir | Sí | 0004 relaja solo `chk_leads_conversion` |
| Proyecto | `organization_id` | No | Tenant del proyecto | No | Rediseño futuro; sin cambio en 4.5 |
| Miembro de proyecto | `organization_id` | No | FK compuesta con proyecto y aislamiento | No | Rediseño futuro de parent FK y scope |
| Hito | `organization_id` | No | FK compuesta con proyecto | No | Rediseño futuro de parent FK |
| Entregable | `organization_id` | No | FK compuesta con proyecto/hito | No | Rediseño futuro de parent FKs |
| Ticket | `organization_id` | No | Tenant y FKs opcionales a proyecto | No | Rediseño futuro de requester, scope y FKs |
| Comentario de ticket | `organization_id` | No | FK compuesta con ticket | No | Depende del rediseño de tickets |
| Tarea | `organization_id` | Sí | Contexto de proyecto/ticket o tarea interna | Sí, solo sin proyecto/ticket | Ninguno; `chk_tasks_context_organization` lo delimita |
| Archivo | `organization_id` | No | Tenant, audiencia y FKs a padres | No | Rediseño futuro integral; sin cambio en 4.5 |
| Auditoría | `organization_id` | Sí | Contexto organizacional opcional del evento | Sí | Ninguno |
| Membresía | `organization_id` | No | Relación explícita usuario-organización | No aplica | Ninguno; no es prerrequisito global |

`organization_id=NULL` significa recurso sin asociación organizacional. Nunca significa
recurso público, tenant compartido ni membresía implícita.

## Autorización

- `/me` continúa permitiendo usuario local activo sin membresías.
- Servicios administrativos usan roles/permisos globales.
- Leads internos usan `global` o `assigned` y no requieren organización.
- El repositorio de leads rechaza scopes `organization`, `own` o `public`.
- Scopes `assigned`/`own` pueden operar sin IDs organizacionales cuando el repositorio
  declara un recurso standalone; si el repositorio proporciona columna organizacional, esa
  columna sigue formando parte del filtro.
- Las membresías solo se consultan para recursos realmente asociados a una organización.

## Migraciones

- `0004_phase4-5-lead-standalone-conversion.sql`: permite organización opcional al convertir.
- `0005_phase4-5-services-manage.sql`: agrega el permiso administrativo del catálogo.

Ambas tienen preflight, postflight y rollback. El 23 de julio de 2026 se aplicaron en orden
sobre `GestionIlvox.public` después de un backup verificado. El estado físico final es
19 tablas, 204 columnas, 43 FK, 57 checks, 15 unique y 54 índices explícitos; RBAC quedó en
11 roles, 37 permisos y 159 asociaciones distintas.

Los smoke tests reales confirmaron standalone sin efectos organizacionales, create/reuse
compatibles, ausencia de contactos e identidades Clerk y limpieza total de fixtures. No se
volvió nullable ningún `organization_id` adicional.
