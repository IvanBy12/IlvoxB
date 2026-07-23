# Validación runtime de PostgreSQL

Fecha: 2026-07-22  
Estado: **completada satisfactoriamente como evidencia runtime oficial en PostgreSQL 18.4**.
La familia soportada es PostgreSQL 18.x. PostgreSQL 16 no fue probado ni está soportado, y no es un gate.

## Conexión sanitizada y aislamiento

| Dato | Valor |
| --- | --- |
| Variable utilizada | `DATABASE_URL`, autorizada por el usuario para esta validación |
| Host | `localhost` |
| Puerto | `5432` |
| Base | `GestionIlvox` |
| Versión | `18.4` |
| Esquema previo | `public`, con 19 tablas |
| Credenciales expuestas | No |
| Esquema temporal final | `ilvox_validation_20260722_af309243` |
| Esquema temporal eliminado | Sí; conteo posterior 0 |

La base ya contenía 19 tablas en `public`. No se sobrescribieron ni se usaron sus datos. Se creó un esquema aleatorio, se fijó el `search_path` al esquema temporal y solo se eliminó ese esquema al finalizar.

## Integridad y aplicación del SQL

- SQL original: `46D9EDDF29A0ABC25091E43867D0AC6B11A1AE180BDDF12665254BE9CD178CD6`.
- Baseline: `46D9EDDF29A0ABC25091E43867D0AC6B11A1AE180BDDF12665254BE9CD178CD6`.
- Hash esperado: `46D9EDDF29A0ABC25091E43867D0AC6B11A1AE180BDDF12665254BE9CD178CD6`.
- Coincidencia: sí, byte a byte.
- Archivo ejecutado: SQL original completo, sin editar.
- Resultado: passed.
- Tiempo de la ejecución final: 230.97 ms.
- Advertencia/notice de aplicación: `pgcrypto` ya existía y `IF NOT EXISTS` la omitió.
- Los dos bloques `BEGIN/COMMIT` finalizaron y la semilla quedó disponible para consultas.

## Inventario real del catálogo

| Elemento | Resultado |
| --- | ---: |
| Esquemas temporales usados | 1 |
| Tablas | 19 |
| Columnas | 199 |
| Primary keys | 19 |
| Unique constraints | 15 |
| Foreign keys | 43 |
| Check constraints | 55 |
| Identity | 1 |
| Generadas almacenadas | 1 |
| Índices físicos | 87 |

Tablas: `app_users`, `audit_events`, `deliverables`, `files`, `identity_webhook_events`, `leads`, `organization_memberships`, `organizations`, `permissions`, `project_members`, `project_milestones`, `projects`, `role_permissions`, `roles`, `services`, `tasks`, `ticket_comments`, `tickets`, `user_roles`.

Identity: `tickets.ticket_number`.

Columna generada: `tickets.code`, con expresión normalizada por PostgreSQL:

```sql
(((('TCK-'::text || (ticket_year)::text) || '-'::text) || repeat('0'::text, GREATEST((6 - length((ticket_number)::text)), 0))) || (ticket_number)::text)
```

## Paridad runtime contra snapshot Drizzle

Se compararon individualmente 19 tablas y 199 columnas contra `drizzle/migrations/meta/0000_snapshot.json`, incluyendo tipo, longitud, nullabilidad, default, identity y generated.

- Diferencias estructurales: 0.
- Estructuras FK comparadas: 43; acciones y columnas coinciden.
- `CHECK` por nombre: coincidencia completa.
- Índices explícitos por nombre: 53/53.
- Drift nominal: 28 FK inline y 4 UNIQUE inline reciben nombres diferentes en el DDL de Drizzle respecto de los nombres implícitos creados por PostgreSQL desde el SQL original.
- Resultado: `structural_match_with_name_drift`.

El drift es de identificadores, no de integridad ni comportamiento. Debe resolverse explícitamente antes de generar migraciones que referencien esos nombres; no se modificó el catálogo ni se ejecutó `push`.

## Explicación definitiva de índices

| Categoría | Cantidad | Origen | Incluidos en los 53 | Incluidos en total físico |
| --- | ---: | --- | --- | --- |
| Índices explícitos no únicos | 52 | `CREATE INDEX` | Sí | Sí |
| Índice explícito único parcial | 1 | `CREATE UNIQUE INDEX` | Sí | Sí |
| Índices de primary key | 19 | Creados automáticamente por PostgreSQL | No | Sí |
| Índices de unique constraints | 15 | Creados automáticamente por PostgreSQL | No | Sí |
| **Total** | **87** | Catálogo `pg_index` | **53** | **87** |

Por tanto:

- 53 es correcto para los índices escritos explícitamente: 52 ordinarios + 1 único parcial.
- 87 es el total físico real: 53 + 19 PK + 15 UNIQUE.
- 74 no es el total físico de este SQL. Numéricamente equivale a 53 + 19 + 2, por lo que omitió 13 de los 15 índices creados por restricciones UNIQUE.
- Sin la lista histórica no puede saberse cuáles dos UNIQUE sí fueron contados, pero ningún agrupamiento real del catálogo produce 74.
- PostgreSQL no crea índices automáticamente para FK.

Índices parciales (9): `idx_audit_events_request`, `idx_files_deliverable`, `idx_files_organization_active`, `idx_files_project`, `idx_files_task`, `idx_files_ticket`, `idx_files_ticket_comment`, `idx_ticket_comments_client_visible`, `uq_organizations_country_tax_normalized`.

Índices de expresión (2): `idx_app_users_primary_email_lower`, `idx_leads_email_lower`.

### Índices de PK

- `app_users_pkey`
- `audit_events_pkey`
- `deliverables_pkey`
- `files_pkey`
- `identity_webhook_events_pkey`
- `leads_pkey`
- `organization_memberships_pkey`
- `organizations_pkey`
- `permissions_pkey`
- `project_members_pkey`
- `project_milestones_pkey`
- `projects_pkey`
- `role_permissions_pkey`
- `roles_pkey`
- `services_pkey`
- `tasks_pkey`
- `ticket_comments_pkey`
- `tickets_pkey`
- `user_roles_pkey`

### Índices de UNIQUE constraints

- `app_users_clerk_user_id_key`
- `identity_webhook_events_clerk_event_id_key`
- `permissions_code_key`
- `services_name_key`
- `uq_deliverables_id_organization`
- `uq_files_provider_object_key`
- `uq_project_milestones_id_organization`
- `uq_projects_id_organization`
- `uq_roles_id_scope`
- `uq_roles_scope_code`
- `uq_tasks_id_organization`
- `uq_ticket_comments_id_organization`
- `uq_tickets_code`
- `uq_tickets_id_organization`
- `uq_tickets_ticket_number`

## Pruebas de las 55 restricciones CHECK

Resultado: **55 aprobadas, 0 fallidas, 0 omitidas**.

Cada caso creó datos mínimos válidos dentro de una transacción, ejecutó una actualización válida, provocó un valor inválido, verificó SQLSTATE `23514` y el nombre de la restricción, volvió al savepoint y terminó con `ROLLBACK`. Para `chk_tasks_single_context`, que es lógicamente solapada por `chk_tasks_context_organization` y se evalúa después por nombre, se renombró temporalmente la segunda dentro del savepoint; el rollback restauró el catálogo.

| Restricción | Tabla | Caso válido | Caso inválido | Resultado |
| --- | --- | --- | --- | --- |
| `chk_app_users_clerk_user_id_not_blank` | `app_users` | accepted | rejected por `chk_app_users_clerk_user_id_not_blank` | passed |
| `chk_app_users_primary_email_not_blank` | `app_users` | accepted | rejected por `chk_app_users_primary_email_not_blank` | passed |
| `chk_app_users_status` | `app_users` | accepted | rejected por `chk_app_users_status` | passed |
| `chk_roles_scope` | `roles` | accepted | rejected por `chk_roles_scope` | passed |
| `chk_roles_code_not_blank` | `roles` | accepted | rejected por `chk_roles_code_not_blank` | passed |
| `chk_roles_name_not_blank` | `roles` | accepted | rejected por `chk_roles_name_not_blank` | passed |
| `chk_permissions_code_not_blank` | `permissions` | accepted | rejected por `chk_permissions_code_not_blank` | passed |
| `chk_permissions_module_not_blank` | `permissions` | accepted | rejected por `chk_permissions_module_not_blank` | passed |
| `chk_permissions_name_not_blank` | `permissions` | accepted | rejected por `chk_permissions_name_not_blank` | passed |
| `chk_user_roles_global_scope` | `user_roles` | accepted | rejected por `chk_user_roles_global_scope` | passed |
| `chk_identity_webhook_events_status` | `identity_webhook_events` | accepted | rejected por `chk_identity_webhook_events_status` | passed |
| `chk_identity_webhook_events_attempt_count` | `identity_webhook_events` | accepted | rejected por `chk_identity_webhook_events_attempt_count` | passed |
| `chk_identity_webhook_events_processed_at` | `identity_webhook_events` | accepted | rejected por `chk_identity_webhook_events_processed_at` | passed |
| `chk_organizations_name_not_blank` | `organizations` | accepted | rejected por `chk_organizations_name_not_blank` | passed |
| `chk_organizations_size` | `organizations` | accepted | rejected por `chk_organizations_size` | passed |
| `chk_organizations_status` | `organizations` | accepted | rejected por `chk_organizations_status` | passed |
| `chk_organizations_country_code` | `organizations` | accepted | rejected por `chk_organizations_country_code` | passed |
| `chk_organizations_tax_fields` | `organizations` | accepted | rejected por `chk_organizations_tax_fields` | passed |
| `chk_organization_memberships_scope` | `organization_memberships` | accepted | rejected por `chk_organization_memberships_scope` | passed |
| `chk_organization_memberships_status` | `organization_memberships` | accepted | rejected por `chk_organization_memberships_status` | passed |
| `chk_organization_memberships_timestamps` | `organization_memberships` | accepted | rejected por `chk_organization_memberships_timestamps` | passed |
| `chk_services_category` | `services` | accepted | rejected por `chk_services_category` | passed |
| `chk_leads_source` | `leads` | accepted | rejected por `chk_leads_source` | passed |
| `chk_leads_status` | `leads` | accepted | rejected por `chk_leads_status` | passed |
| `chk_leads_conversion` | `leads` | accepted | rejected por `chk_leads_conversion` | passed |
| `chk_projects_status` | `projects` | accepted | rejected por `chk_projects_status` | passed |
| `chk_projects_priority` | `projects` | accepted | rejected por `chk_projects_priority` | passed |
| `chk_projects_dates` | `projects` | accepted | rejected por `chk_projects_dates` | passed |
| `chk_project_members_scope` | `project_members` | accepted | rejected por `chk_project_members_scope` | passed |
| `chk_project_milestones_status` | `project_milestones` | accepted | rejected por `chk_project_milestones_status` | passed |
| `chk_project_milestones_completed_at` | `project_milestones` | accepted | rejected por `chk_project_milestones_completed_at` | passed |
| `chk_deliverables_status` | `deliverables` | accepted | rejected por `chk_deliverables_status` | passed |
| `chk_deliverables_approval` | `deliverables` | accepted | rejected por `chk_deliverables_approval` | passed |
| `chk_tickets_ticket_year` | `tickets` | accepted | rejected por `chk_tickets_ticket_year` | passed |
| `chk_tickets_type` | `tickets` | accepted | rejected por `chk_tickets_type` | passed |
| `chk_tickets_requested_priority` | `tickets` | accepted | rejected por `chk_tickets_requested_priority` | passed |
| `chk_tickets_priority` | `tickets` | accepted | rejected por `chk_tickets_priority` | passed |
| `chk_tickets_status` | `tickets` | accepted | rejected por `chk_tickets_status` | passed |
| `chk_tickets_resolution` | `tickets` | accepted | rejected por `chk_tickets_resolution` | passed |
| `chk_tickets_closed_at` | `tickets` | accepted | rejected por `chk_tickets_closed_at` | passed |
| `chk_ticket_comments_visibility` | `ticket_comments` | accepted | rejected por `chk_ticket_comments_visibility` | passed |
| `chk_ticket_comments_content` | `ticket_comments` | accepted | rejected por `chk_ticket_comments_content` | passed |
| `chk_tasks_priority` | `tasks` | accepted | rejected por `chk_tasks_priority` | passed |
| `chk_tasks_status` | `tasks` | accepted | rejected por `chk_tasks_status` | passed |
| `chk_tasks_estimated_minutes` | `tasks` | accepted | rejected por `chk_tasks_estimated_minutes` | passed |
| `chk_tasks_single_context` | `tasks` | accepted | rejected por `chk_tasks_single_context` | passed |
| `chk_tasks_context_organization` | `tasks` | accepted | rejected por `chk_tasks_context_organization` | passed |
| `chk_files_object_key_not_blank` | `files` | accepted | rejected por `chk_files_object_key_not_blank` | passed |
| `chk_files_size_bytes` | `files` | accepted | rejected por `chk_files_size_bytes` | passed |
| `chk_files_checksum_sha256` | `files` | accepted | rejected por `chk_files_checksum_sha256` | passed |
| `chk_files_classification` | `files` | accepted | rejected por `chk_files_classification` | passed |
| `chk_files_status` | `files` | accepted | rejected por `chk_files_status` | passed |
| `chk_files_single_parent` | `files` | accepted | rejected por `chk_files_single_parent` | passed |
| `chk_audit_events_old_values_object` | `audit_events` | accepted | rejected por `chk_audit_events_old_values_object` | passed |
| `chk_audit_events_new_values_object` | `audit_events` | accepted | rejected por `chk_audit_events_new_values_object` | passed |

## Pruebas de las 43 claves foráneas

Resultado: **43 aprobadas, 0 fallidas, 0 omitidas**.

Para cada FK se comprobó referencia existente, rechazo de referencia inexistente, acción de actualización y borrado. PostgreSQL 18.4 reportó SQLSTATE `23001` para las acciones `RESTRICT`. Las dos acciones `CASCADE` se probaron con pares rol/permiso aislados, confirmando que solo se eliminó la fila de `role_permissions` y sobrevivió el padre no eliminado.

| FK | Relación | Referencia válida | Referencia inexistente | ON DELETE | ON UPDATE | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| `audit_events_actor_user_id_fkey` | `audit_events` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `audit_events_organization_id_fkey` | `audit_events` → `organizations` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `files_organization_id_fkey` | `files` → `organizations` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `files_uploaded_by_user_id_fkey` | `files` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_files_project` | `files` → `projects` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_files_ticket` | `files` → `tickets` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_files_ticket_comment` | `files` → `ticket_comments` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_files_task` | `files` → `tasks` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_files_deliverable` | `files` → `deliverables` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `leads_service_id_fkey` | `leads` → `services` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `leads_assigned_to_user_id_fkey` | `leads` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `leads_converted_organization_id_fkey` | `leads` → `organizations` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `organization_memberships_organization_id_fkey` | `organization_memberships` → `organizations` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `organization_memberships_user_id_fkey` | `organization_memberships` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_organization_memberships_organization_role` | `organization_memberships` → `roles` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `organizations_account_manager_user_id_fkey` | `organizations` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `deliverables_approved_by_user_id_fkey` | `deliverables` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_deliverables_project` | `deliverables` → `projects` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `project_members_user_id_fkey` | `project_members` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `project_members_assigned_by_user_id_fkey` | `project_members` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_project_members_project` | `project_members` → `projects` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_project_members_project_role` | `project_members` → `roles` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_project_milestones_project` | `project_milestones` → `projects` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `projects_organization_id_fkey` | `projects` → `organizations` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `projects_service_id_fkey` | `projects` → `services` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `projects_lead_user_id_fkey` | `projects` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `projects_created_by_user_id_fkey` | `projects` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `role_permissions_role_id_fkey` | `role_permissions` → `roles` | accepted | rejected | CASCADE / not_tested | NO ACTION / no_action_rejected | passed |
| `role_permissions_permission_id_fkey` | `role_permissions` → `permissions` | accepted | rejected | CASCADE / not_tested | NO ACTION / no_action_rejected | passed |
| `user_roles_user_id_fkey` | `user_roles` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `user_roles_assigned_by_user_id_fkey` | `user_roles` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_user_roles_global_role` | `user_roles` → `roles` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `tasks_organization_id_fkey` | `tasks` → `organizations` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `tasks_assigned_to_user_id_fkey` | `tasks` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `tasks_created_by_user_id_fkey` | `tasks` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_tasks_project` | `tasks` → `projects` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_tasks_ticket` | `tasks` → `tickets` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `ticket_comments_author_user_id_fkey` | `ticket_comments` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_ticket_comments_ticket` | `ticket_comments` → `tickets` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `tickets_organization_id_fkey` | `tickets` → `organizations` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `tickets_requester_user_id_fkey` | `tickets` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `tickets_assigned_to_user_id_fkey` | `tickets` → `app_users` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |
| `fk_tickets_project` | `tickets` → `projects` | accepted | rejected | RESTRICT / restricted | NO ACTION / no_action_rejected | passed |

Cascadas:

- `role_permissions_role_id_fkey`: hijo eliminado, permiso no relacionado conservado.
- `role_permissions_permission_id_fkey`: hijo eliminado, rol no relacionado conservado.

## Identity y columna generada

| Caso | Resultado |
| --- | --- |
| Inicio en 1 | `TCK-2026-000001` |
| Seis dígitos | `TCK-2026-100000` |
| Más de seis dígitos | `TCK-2026-1000001` |
| Incremento siguiente | `TCK-2028-1000002` |
| Valor identity manual | Rechazado con SQLSTATE `428C9` |
| Actualización del año fuente | `TCK-2027-000001` |

Resultado general: passed.

## Semilla RBAC real

| Métrica | Resultado |
| --- | ---: |
| Roles | 11 |
| Permisos | 23 |
| Asociaciones | 142 |
| Asociaciones distintas | 142 |
| Duplicados | 0 |
| Roles inexistentes | 0 |
| Permisos inexistentes | 0 |
| Roles sin permisos | 0 |
| Permisos sin roles | 0 |

Coincide completamente con la auditoría estática.

## Rollback y limpieza

Se demostraron rollback de:

- inserción;
- actualización;
- eliminación;
- operación de varias tablas.

Antes de eliminar el esquema había 0 filas residuales de prueba en las tablas no semilla. Después se eliminó exclusivamente `ilvox_validation_20260722_af309243` con resultado satisfactorio y se confirmó que no permanecía en `pg_namespace`.

## Limitación de versión

La sintaxis, restricciones y pruebas funcionaron en PostgreSQL 18.4 y constituyen la prueba runtime oficial. No se afirma compatibilidad con PostgreSQL 16. Si el proyecto adopta una versión fuera de PostgreSQL 18.x, deberá repetir baseline, catálogo, migraciones, rollbacks y pruebas antes del despliegue.
