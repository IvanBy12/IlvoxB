# Diferencias definitivas entre roles

## `super_admin` frente a `admin`

| Permiso o grupo | super_admin | admin | Motivo |
| --- | :---: | :---: | --- |
| 20 permisos operativos existentes excepto los tres siguientes | Sí | Sí | administración diaria; admin siempre acotado por grants/scope |
| `roles.manage` | Sí | No | evita asignación global/elevación indirecta |
| `users.manage` | Sí | No | incluye targets privilegiados/globales |
| `audit.read` | Sí | No | auditoría global puede revelar otras organizaciones |
| `users.manage_non_privileged` | Sí | Sí | reemplazo operativo; excluye privilegios y alcance propio |
| `audit.read_scoped` | Sí | Sí | reemplazo operativo con filtro obligatorio |
| `tickets.confirm_resolution` | Sí | No | admin ya usa flujo interno de tickets |
| `tickets.reject_resolution` | Sí | No | acción de intención cliente |
| `tickets.request_reopen` | Sí | No | acción de intención cliente |
| `organization_members.manage` | Sí | No | admin no necesita administrar membresías mediante permiso cliente; usa servicio interno acotado futuro |
| `files.read_client` | Sí | No | admin usa `files.read` con política interna |
| `files.upload_client` | Sí | No | admin usa `files.upload` con política interna |
| `permissions.manage` | Sí | No | catálogo global |
| `roles.assign_super_admin` | Sí | No | elevación crítica |
| `security.manage` | Sí | No | seguridad global |
| `system.configure` | Sí | No | configuración global |
| `organizations.access_all` | Sí | No | alcance transversal |

Resultado: `super_admin` 36; `admin` 22. Admin no puede modificar su rol privilegiado, ampliar su scope, crear/asignar superadmin, tocar permisos globales, acceder transversalmente ni afectar al último superadmin.

## `client_manager` frente a `client_contact`

| Operación | client_manager | client_contact | Scope obligatorio |
| --- | :---: | :---: | --- |
| leer organización permitida | Sí | solo contexto propio | organization / own |
| administrar miembros cliente | Sí | No | organization activa |
| leer proyectos | todos los visibles de su organización según política | solo asignados | organization / assigned |
| leer tickets | organización según política | requester/asignado/proyecto asignado | organization / own / assigned |
| crear ticket/comentario cliente | Sí | Sí | organization + recurso autorizado |
| confirmar/rechazar resolución | Sí | Sí | ticket autorizado en `resolved` |
| solicitar reapertura | Sí | Sí | ticket autorizado en `closed` y ventana vigente |
| leer/cargar archivo cliente | Sí | Sí | padre cliente, organization + own/assigned |
| leer comentarios/archivos internos | No | No | denegación absoluta |
| cambiar estado/cerrar directamente | No | No | usan acciones específicas |
| asignar roles internos/globales | No | No | denegación absoluta |
| gestionar otros contactos | membresías cliente de su organización | No | organization |

Resultados proyectados: `client_manager` 11 permisos; `client_contact` 10.
