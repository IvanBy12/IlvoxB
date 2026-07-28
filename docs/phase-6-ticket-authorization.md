# Autorización de tickets de Fase 6

## Scopes SQL

- `global`: solo grants globales explícitos.
- `assigned`: actor asignado o miembro activo del proyecto.
- `own`: solicitante; si el ticket es organizacional también se exige
  membership activa.
- `organization`: ID concedido y membership activa comprobada en SQL.
- `project`: se materializa como `assigned` y exige `project_members.status =
  'active'` dentro de SQL.

`organization_id IS NULL` solo coincide con el solicitante exacto. Nunca
representa público, tenant global ni conjunto de usuarios sin organización.

Los usuarios locales activos reciben únicamente capacidades implícitas `own`
para leer/crear/editar sus tickets standalone, comentar para cliente y decidir
su resolución. No se crea rol, organización o membership artificial.

## Roles globales

`super_admin`, `admin` y `support_agent` conservan scope global explícito para
permisos de tickets concedidos. `project_lead` y `contributor` globales se
reducen a `assigned`; `sales` se reduce a `own`. Los roles organization nunca
reciben global.

Las revocaciones de `organization_memberships` y `project_members` se
revalidan dentro de cada consulta, por lo que una identidad previamente
materializada no conserva acceso.
