# Mapeo de las 32 diferencias nominales originales

Fecha: 2026-07-22. Todas usan estrategia A. Riesgo original común: generación de `DROP/ADD`, bloqueo o rollback contra un nombre inexistente. Riesgo residual bajo por nombres explícitos y auditoría.

| Tabla | Columnas | Nombre PostgreSQL / final | Nombre Drizzle anterior | Tipo | Archivo:línea | Acción |
| --- | --- | --- | --- | --- | --- | --- |
| `audit_events` | `actor_user_id` | `audit_events_actor_user_id_fkey` | `audit_events_actor_user_id_app_users_id_fk` | FK | `audit.ts:35` | FK explícita |
| `audit_events` | `organization_id` | `audit_events_organization_id_fkey` | `audit_events_organization_id_organizations_id_fk` | FK | `audit.ts:40` | FK explícita |
| `files` | `organization_id` | `files_organization_id_fkey` | `files_organization_id_organizations_id_fk` | FK | `files.ts:57` | FK explícita |
| `files` | `uploaded_by_user_id` | `files_uploaded_by_user_id_fkey` | `files_uploaded_by_user_id_app_users_id_fk` | FK | `files.ts:62` | FK explícita |
| `leads` | `service_id` | `leads_service_id_fkey` | `leads_service_id_services_id_fk` | FK | `leads.ts:47` | FK explícita |
| `leads` | `assigned_to_user_id` | `leads_assigned_to_user_id_fkey` | `leads_assigned_to_user_id_app_users_id_fk` | FK | `leads.ts:52` | FK explícita |
| `leads` | `converted_organization_id` | `leads_converted_organization_id_fkey` | `leads_converted_organization_id_organizations_id_fk` | FK | `leads.ts:57` | FK explícita |
| `organization_memberships` | `organization_id` | `organization_memberships_organization_id_fkey` | `organization_memberships_organization_id_organizations_id_fk` | FK | `organizations.ts:105` | FK explícita |
| `organization_memberships` | `user_id` | `organization_memberships_user_id_fkey` | `organization_memberships_user_id_app_users_id_fk` | FK | `organizations.ts:110` | FK explícita |
| `organizations` | `account_manager_user_id` | `organizations_account_manager_user_id_fkey` | `organizations_account_manager_user_id_app_users_id_fk` | FK | `organizations.ts:45` | FK explícita |
| `deliverables` | `approved_by_user_id` | `deliverables_approved_by_user_id_fkey` | `deliverables_approved_by_user_id_app_users_id_fk` | FK | `projects.ts:195` | FK explícita |
| `project_members` | `user_id` | `project_members_user_id_fkey` | `project_members_user_id_app_users_id_fk` | FK | `projects.ts:104` | FK explícita |
| `project_members` | `assigned_by_user_id` | `project_members_assigned_by_user_id_fkey` | `project_members_assigned_by_user_id_app_users_id_fk` | FK | `projects.ts:109` | FK explícita |
| `projects` | `organization_id` | `projects_organization_id_fkey` | `projects_organization_id_organizations_id_fk` | FK | `projects.ts:52` | FK explícita |
| `projects` | `service_id` | `projects_service_id_fkey` | `projects_service_id_services_id_fk` | FK | `projects.ts:57` | FK explícita |
| `projects` | `lead_user_id` | `projects_lead_user_id_fkey` | `projects_lead_user_id_app_users_id_fk` | FK | `projects.ts:62` | FK explícita |
| `projects` | `created_by_user_id` | `projects_created_by_user_id_fkey` | `projects_created_by_user_id_app_users_id_fk` | FK | `projects.ts:67` | FK explícita |
| `role_permissions` | `role_id` | `role_permissions_role_id_fkey` | `role_permissions_role_id_roles_id_fk` | FK CASCADE | `rbac.ts:70` | FK explícita |
| `role_permissions` | `permission_id` | `role_permissions_permission_id_fkey` | `role_permissions_permission_id_permissions_id_fk` | FK CASCADE | `rbac.ts:75` | FK explícita |
| `user_roles` | `user_id` | `user_roles_user_id_fkey` | `user_roles_user_id_app_users_id_fk` | FK | `rbac.ts:97` | FK explícita |
| `user_roles` | `assigned_by_user_id` | `user_roles_assigned_by_user_id_fkey` | `user_roles_assigned_by_user_id_app_users_id_fk` | FK | `rbac.ts:102` | FK explícita |
| `tasks` | `organization_id` | `tasks_organization_id_fkey` | `tasks_organization_id_organizations_id_fk` | FK | `tasks.ts:53` | FK explícita |
| `tasks` | `assigned_to_user_id` | `tasks_assigned_to_user_id_fkey` | `tasks_assigned_to_user_id_app_users_id_fk` | FK | `tasks.ts:58` | FK explícita |
| `tasks` | `created_by_user_id` | `tasks_created_by_user_id_fkey` | `tasks_created_by_user_id_app_users_id_fk` | FK | `tasks.ts:63` | FK explícita |
| `ticket_comments` | `author_user_id` | `ticket_comments_author_user_id_fkey` | `ticket_comments_author_user_id_app_users_id_fk` | FK | `tickets.ts:156` | FK explícita |
| `tickets` | `organization_id` | `tickets_organization_id_fkey` | `tickets_organization_id_organizations_id_fk` | FK | `tickets.ts:81` | FK explícita |
| `tickets` | `requester_user_id` | `tickets_requester_user_id_fkey` | `tickets_requester_user_id_app_users_id_fk` | FK | `tickets.ts:86` | FK explícita |
| `tickets` | `assigned_to_user_id` | `tickets_assigned_to_user_id_fkey` | `tickets_assigned_to_user_id_app_users_id_fk` | FK | `tickets.ts:91` | FK explícita |
| `app_users` | `clerk_user_id` | `app_users_clerk_user_id_key` | `app_users_clerk_user_id_unique` | UNIQUE | `identity.ts:26` | UNIQUE explícita |
| `identity_webhook_events` | `clerk_event_id` | `identity_webhook_events_clerk_event_id_key` | `identity_webhook_events_clerk_event_id_unique` | UNIQUE | `identity.ts:63` | UNIQUE explícita |
| `permissions` | `code` | `permissions_code_key` | `permissions_code_unique` | UNIQUE | `rbac.ts:53` | UNIQUE explícita |
| `services` | `name` | `services_name_key` | `services_name_unique` | UNIQUE | `services.ts:22` | UNIQUE explícita |

Resultado final: 32 resueltas, 0 restantes y ningún índice único adicional.
