# Catálogo definitivo de permisos propuestos

Estado: catálogo objetivo para aprobación; no aplicado. Los 23 primeros ya existen; los 13 marcados “nuevo” son propuesta.

| Permiso | Recurso / acción | Scope permitido | Roles objetivo / límite principal |
| --- | --- | --- | --- |
| `organizations.read` | organización / leer | global, organization, assigned | roles actuales; siempre filtrar |
| `organizations.manage` | entidad organización / crear-modificar | global, assigned | internos actuales; no membresías |
| `leads.read` | lead / leer | global, assigned | internos actuales |
| `leads.manage` | lead / crear-asignar-convertir | global, assigned | internos actuales; transición válida |
| `services.read` | servicio / leer | public, global | roles actuales/público activo |
| `projects.read` | proyecto / leer | global, organization, assigned | roles actuales |
| `projects.manage` | proyecto/hito/entregable / modificar | global, assigned | internos/líder de proyecto |
| `tasks.read` | tarea / leer | global, assigned | roles actuales |
| `tasks.manage` | tarea / crear-asignar-transicionar | global, assigned | roles actuales |
| `tickets.read` | ticket y comentarios visibles / leer | global, organization, assigned, own | roles actuales |
| `tickets.create` | ticket / crear | organization, assigned, own | roles actuales |
| `tickets.assign` | ticket / asignar | global, assigned | internos actuales |
| `tickets.change_status` | ticket / transición interna | global, assigned | clientes excluidos |
| `tickets.resolve` | ticket / resolver | global, assigned | internos actuales |
| `tickets.close` | ticket / cierre interno | global, assigned | clientes excluidos |
| `ticket_comments.read_internal` | comentario interno / leer | global, assigned | solo internos autorizados |
| `ticket_comments.create_client` | comentario cliente / crear | organization, assigned, own | roles actuales; servidor fija audiencia |
| `ticket_comments.create_internal` | comentario interno / crear | global, assigned | solo internos |
| `files.read` | archivo operativo/interno / leer | global, assigned | clientes excluidos |
| `files.upload` | archivo operativo/interno / crear | global, assigned | clientes excluidos |
| `users.manage` | cualquier perfil local / administrar | global | solo super_admin |
| `roles.manage` | roles sembrados no superadmin / asignar | global | solo super_admin |
| `audit.read` | auditoría completa / leer | global | solo super_admin |
| `tickets.confirm_resolution` (nuevo) | ticket / `resolved→closed` | global, organization, assigned, own | superadmin y clientes autorizados |
| `tickets.reject_resolution` (nuevo) | ticket / `resolved→reopened` | global, organization, assigned, own | mismos; motivo obligatorio |
| `tickets.request_reopen` (nuevo) | ticket / solicitar desde `closed` | global, organization, assigned, own | mismos; no reabre directamente |
| `organization_members.manage` (nuevo) | membresía cliente / administrar | global, organization | superadmin, client_manager |
| `users.manage_non_privileged` (nuevo) | perfil inferior / administrar | global restringido | superadmin, admin |
| `audit.read_scoped` (nuevo) | auditoría / leer acotada | organization, assigned | superadmin, admin |
| `permissions.manage` (nuevo) | permiso/matriz / CRUD, grant, revoke, read | global | solo super_admin |
| `roles.assign_super_admin` (nuevo) | rol superadmin / asignar-revocar | global | solo super_admin + guardas reforzadas |
| `security.manage` (nuevo) | seguridad / sesiones-incidentes-política | global | solo super_admin; no control total |
| `system.configure` (nuevo) | configuración global no secreta / modificar | global | solo super_admin |
| `organizations.access_all` (nuevo) | capacidad de scope transversal | global | solo super_admin; requiere permiso de acción |
| `files.read_client` (nuevo) | archivo de audiencia cliente / leer | global, organization, assigned, own | superadmin y clientes; padre verificable |
| `files.upload_client` (nuevo) | archivo de audiencia cliente / crear | global, organization, assigned, own | superadmin y clientes; servidor fija padre/audiencia |

Total objetivo: **36 permisos**. Ningún scope se confía al navegador ni se almacena necesariamente como texto en la tabla actual.
