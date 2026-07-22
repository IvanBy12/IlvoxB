# Cambios RBAC propuestos

Estado: **NO APROBADOS Y NO APLICADOS**. Catálogo real: 11 roles, 23 permisos y 142 asociaciones distintas.

## Resultado definitivo para aprobación

- 13 permisos nuevos; total proyectado: **36**.
- 11 asociaciones retiradas: 3 de `admin` y 4 de cada rol cliente.
- 26 asociaciones agregadas: 13 a `super_admin`, 2 a `admin`, 6 a `client_manager`, 5 a `client_contact`.
- Total proyectado: **157 asociaciones distintas** (`142 - 11 + 26`).

Los dos permisos adicionales respecto de la propuesta anterior son `files.read_client` y `files.upload_client`. Los clientes pierden `files.read`/`files.upload`; esos permisos genéricos quedan para operadores internos. Un archivo cliente solo es autorizable cuando la consulta demuestra organización, padre, audiencia cliente y estado. `classification` (`internal`/`confidential`) no equivale a audiencia; si el padre no permite inferir visibilidad cliente, se deniega hasta una migración futura aprobada.

## Fronteras sin ambigüedad

| Permiso | Recurso y acciones | Actores | Alcance | Prohibición expresa |
| --- | --- | --- | --- | --- |
| `organization_members.manage` | membresías de una organización: invitar, activar, revocar y cambiar entre roles cliente | superadmin; client_manager | organization | no crea/desactiva `app_users`, no asigna roles internos/globales |
| `users.manage_non_privileged` | perfil local y estado de usuarios no privilegiados | superadmin; admin | global acotado a targets inferiores | no toca superadmins, privilegios, membresías ni al propio alcance |
| `organizations.manage` | datos de la entidad organización | roles internos actuales | grant/organization | no administra membresías ni roles |
| `roles.manage` | asignaciones de roles sembrados excepto superadmin | solo superadmin en propuesta | global | no sustituye `roles.assign_super_admin` |
| `permissions.manage` | catálogo/matriz global | solo superadmin | global | no omite controles de último superadmin ni autoelevación |

## Separación de roles

- `super_admin`: 36 permisos; único con `roles.manage`, `users.manage`, `audit.read`, los cinco permisos globales sensibles y acceso transversal controlado.
- `admin`: 22 permisos; mantiene 20 capacidades operativas y recibe `users.manage_non_privileged`/`audit.read_scoped`. No puede crear/asignar superadmin, alterar catálogo global, ampliar su scope ni consultar toda organización por defecto.
- `client_manager`: 11 permisos proyectados; alcance organización y gestión de miembros cliente.
- `client_contact`: 10 permisos proyectados; recursos propios/asignados, sin gestión de miembros ni lectura general de la organización.

## Guardas obligatorias

Denegar salvo identidad Clerk verificada, perfil local `active`, membresía activa cuando aplique, rol válido, permiso efectivo, scope, organización, recurso y estado compatibles. Roles, permisos y organización enviados por el navegador no son autoridad. Los filtros entran en el SQL del repositorio.

`roles.assign_super_admin` exige superadmin efectivo, permiso explícito, target local activo, confirmación, transacción, auditoría, idempotencia y protección del último superadmin; prohíbe autoasignación salvo bootstrap documentado. En el futuro exigirá sesión reciente/reautenticación.

El borrador reversible es `docs/proposals/rbac-changes-not-approved.sql`; termina en `ROLLBACK` y no fue ejecutado.
