# Matriz RBAC propuesta

Estado: **PROPUESTA NO APROBADA — NO APLICADA**. Los permisos siempre se combinan con scope y filtros de recurso.

| Permiso nuevo | Recurso/acción | Roles recomendados | Scope | Riesgo mitigado |
| --- | --- | --- | --- | --- |
| `tickets.confirm_resolution` | confirmar `resolved → closed` | super_admin, client_manager, client_contact | global/organization/own/assigned | cierre arbitrario |
| `tickets.reject_resolution` | rechazar `resolved → reopened` con motivo | mismos | global/organization/own/assigned | estado final elegido por cliente |
| `tickets.request_reopen` | solicitar reapertura de `closed` | mismos | global/organization/own/assigned | reapertura directa |
| `organization_members.manage` | membresías no privilegiadas | super_admin, client_manager | global/organization | asignación de roles internos |
| `users.manage_non_privileged` | estado/perfil local de target inferior | super_admin, admin | global restringido | equivalencia admin-superadmin |
| `audit.read_scoped` | eventos en organizaciones autorizadas | super_admin, admin | global/organization | auditoría transversal |
| `permissions.manage` | CRUD y matriz global de permisos | super_admin | global | escalación por catálogo |
| `roles.assign_super_admin` | asignar/revocar superadmin | super_admin | global | autoelevación/pérdida del último admin |
| `security.manage` | sesiones globales, respuesta a incidentes y política de identidad | super_admin | global | permiso “control total” ambiguo |
| `system.configure` | configuración global no secreta y versionada | super_admin | global | cambio sensible por admin operativo |
| `organizations.access_all` | capacidad transversal, además del permiso de acción | super_admin | global | bypass horizontal implícito |
| `files.read_client` | leer/descargar archivo con audiencia cliente demostrada | super_admin, client_manager, client_contact | global/organization/own/assigned | lectura de archivos internos |
| `files.upload_client` | cargar a un padre cliente permitido | super_admin, client_manager, client_contact | global/organization/own/assigned | creación de archivo interno por cliente |

`security.manage` incluye revocación global de sesiones, bloqueo de emergencia, política de autenticación y rotación coordinada de referencias a secretos/webhooks. No incluye leer secretos, gestionar permisos/roles, datos de organizaciones, facturación ni configuración funcional.

`permissions.manage` se mantiene único para el MVP, pero el servicio distingue `create`, `update`, `grant`, `revoke` y `read_matrix`, audita cada operación e impide autoaprobación. Si aparecen operadores delegados, se dividirá antes de otorgarlo a otro rol.

`organizations.access_all` solo amplía el scope de una acción que ya tenga permiso; no concede por sí solo leer, modificar o borrar recursos.

## Cambios de asociaciones

Retirar: `admin` × (`roles.manage`, `users.manage`, `audit.read`); ambos roles cliente × (`tickets.change_status`, `tickets.close`, `files.read`, `files.upload`).

Agregar: todos los 13 nuevos a `super_admin`; dos reemplazos acotados a `admin`; seis a `client_manager` (tres tickets, miembros, dos archivos cliente); cinco a `client_contact` (tres tickets y dos archivos cliente).

Conteos esperados: 36 permisos y 157 asociaciones distintas.
