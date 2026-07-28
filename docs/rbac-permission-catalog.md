# Catálogo de permisos

Estado físico: **37 permisos y 159 asociaciones distintas** tras 0001–0005 en
`GestionIlvox.public`.

| Permiso | Recurso / acción | Scope permitido | Roles objetivo / límite principal |
| --- | --- | --- | --- |
| `organizations.read` | organización / leer | global, organization, assigned | roles actuales; siempre filtrar |
| `organizations.manage` | organización / crear-modificar | global, assigned | internos autorizados |
| `leads.read` | lead / leer | global, assigned | internos |
| `leads.manage` | lead / asignar-convertir | global, assigned | internos; estado válido |
| `services.read` | servicio / leer | public, global | público solo activo y publicado |
| `services.manage` | servicio / crear-modificar-publicar-ocultar | global | solo `global:super_admin` y `global:admin` |
| `projects.read` | proyecto / leer | global, organization, assigned | roles actuales |
| `projects.manage` | proyecto/hito/entregable / modificar | global, assigned | internos/líder |
| `tasks.read` | tarea / leer | global, assigned | roles actuales |
| `tasks.manage` | tarea / crear-asignar-transicionar | global, assigned | roles actuales |
| `tickets.read` | ticket / leer | global, organization, assigned, own | roles actuales |
| `tickets.create` | ticket / crear | organization, assigned, own | roles actuales |
| `tickets.assign` | ticket / asignar | global, assigned | internos |
| `tickets.change_status` | ticket / transición interna | global, assigned | clientes excluidos |
| `tickets.resolve` | ticket / resolver | global, assigned | internos |
| `tickets.close` | ticket / cierre interno | global, assigned | clientes excluidos |
| `ticket_comments.read_internal` | comentario interno / leer | global, assigned | internos |
| `ticket_comments.create_client` | comentario cliente / crear | organization, assigned, own | servidor fija audiencia |
| `ticket_comments.create_internal` | comentario interno / crear | global, assigned | internos |
| `files.read` | archivo operativo / leer | global, assigned | clientes excluidos |
| `files.upload` | archivo operativo / crear | global, assigned | clientes excluidos |
| `users.manage` | perfil local / administrar | global | solo super_admin |
| `roles.manage` | rol no superadmin / asignar | global | solo super_admin |
| `audit.read` | auditoría completa / leer | global | solo super_admin |
| `tickets.confirm_resolution` | ticket / confirmar | global, organization, assigned, own | autorizados |
| `tickets.reject_resolution` | ticket / rechazar | global, organization, assigned, own | motivo obligatorio |
| `tickets.request_reopen` | ticket / solicitar reapertura | global, organization, assigned, own | no reabre directamente |
| `organization_members.manage` | membership / administrar | global, organization | super_admin/client_manager |
| `users.manage_non_privileged` | perfil inferior / administrar | global restringido | super_admin/admin |
| `audit.read_scoped` | auditoría acotada / leer | organization, assigned | super_admin/admin |
| `permissions.manage` | permiso/matriz / administrar | global | solo super_admin |
| `roles.assign_super_admin` | superadmin / asignar-revocar | global | solo super_admin |
| `security.manage` | seguridad global / administrar | global | solo super_admin |
| `system.configure` | configuración no secreta / modificar | global | solo super_admin |
| `organizations.access_all` | ampliar scope organizacional | global | solo super_admin |
| `files.read_client` | archivo cliente / leer | global, organization, assigned, own | padre verificable |
| `files.upload_client` | archivo cliente / crear | global, organization, assigned, own | servidor fija contexto |

`services.manage` tiene exactamente dos asociaciones, sin roles cliente ni adicionales.
Los cinco permisos globales sensibles permanecen exclusivos de `global:super_admin`.
No se confía ningún scope proporcionado por el navegador.

## Aplicación en Fase 5

No se añadieron permisos ni asociaciones RBAC: el catálogo físico permanece en 37 permisos y
159 asociaciones.

- `projects.read` cubre listados/detalle de proyectos, miembros, hitos y entregables.
- `projects.manage` cubre creación/edición/transición/asignación del proyecto, alta/cambio de
  rol de miembros y mutaciones de hitos/entregables.
- `tasks.read` cubre tareas de proyecto y standalone autorizadas.
- `tasks.manage` cubre creación, edición, asignación y transición.

Los grants de rol de proyecto se materializan como scope `assigned` y se vuelven a comprobar
con `EXISTS project_members` dentro de SQL. Los roles cliente no tienen permisos de tareas.
Fase 5 no crea permisos más granulares sin una migración RBAC aprobada.
# Adición versionada de Fase 6

La migración 0008 añade:

| Permiso | Grants |
| --- | --- |
| `tickets.update` | `global:super_admin`, `global:admin`, `global:support_agent` |
| `tickets.change_priority` | `global:super_admin`, `global:admin`, `global:support_agent` |

El catálogo esperado pasa a 39 permisos y 165 asociaciones. Usuarios locales
activos sin rol no reciben grants globales: AuthorizationService limita sus
capacidades de autoservicio a scope `own`. Roles globales de ventas,
contribución y proyecto no se materializan automáticamente como lectura global
de tickets.
