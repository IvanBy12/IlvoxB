# Propuesta — modelo de organización opcional

Estado: diseño, no migración aprobada.

## Inventario

| Entidad | Columna | Nullable | Integridad contextual |
| --- | --- | ---: | --- |
| `leads` | `converted_organization_id` | Sí | FK simple; check 0004 |
| `projects` | `organization_id` | No | FK organización y unique `(id, organization_id)` |
| `project_members` | `organization_id` | No | FK `(project_id, organization_id)` |
| `project_milestones` | `organization_id` | No | FK compuesta y unique contextual |
| `deliverables` | `organization_id` | No | FK compuesta y unique contextual |
| `tickets` | `organization_id` | No | FK organización y FK opcional compuesta a proyecto |
| `ticket_comments` | `organization_id` | No | FK compuesta al ticket |
| `tasks` | `organization_id` | Sí | Checks de contexto + FKs compuestas |
| `files` | `organization_id` | No | Cinco FKs compuestas a padres |
| `audit_events` | `organization_id` | Sí | Contexto opcional |
| `organization_memberships` | `organization_id` | No | PK/FK, módulo organizacional |

## Riesgo `MATCH SIMPLE`

PostgreSQL omite la validación de una FK compuesta `MATCH SIMPLE` si cualquiera de sus
columnas es `NULL`. Hacer nullable solo `organization_id` permitiría que un `project_id`,
`ticket_id` u otro padre inválido escape de la FK.

No se propone ese cambio aislado.

## Estrategia futura segura

1. Mantener siempre una FK simple no nullable desde el hijo al ID primario del padre cuando
   exista padre. Esta FK garantiza existencia incluso si el contexto es standalone.
2. Derivar el contexto organizacional del padre siempre que sea posible, evitando duplicarlo.
3. Si se conserva `organization_id` denormalizado, añadir una constraint trigger diferible
   que compare hijo y padre con `IS NOT DISTINCT FROM`; una FK compuesta nullable no basta.
4. Separar en el repositorio los predicados tenant-bound de los standalone. `NULL` nunca
   equivale a público.
5. Mantener `organization` scope para recursos con tenant y `global|assigned|own` para
   standalone.
6. Migrar y probar cada agregado completo —padre, hijos, índices, archivos y auditoría— en
   una única decisión de dominio.

`MATCH FULL` tampoco resuelve por sí solo el caso deseado: rechaza parejas parcialmente
nulas, mientras un hijo de un padre standalone necesitaría padre no nulo y organización nula.
