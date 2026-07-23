# Autorización de Fase 4.5

## Sin organización

Un usuario local activo puede operar con roles globales sin memberships. `global`,
`assigned` y `own` no inventan una organización. Para recursos standalone, el repositorio
filtra por actor/assignee; para recursos con columna organizacional, esa columna permanece en
el predicado.

`organization_id=NULL` no es público. Los scopes `organization` y `public` no acceden a
leads standalone. Dos filas con organización nula no forman un tenant.

## Servicios

- lectura pública: `is_public AND is_active`;
- lectura administrativa: `services.read`;
- creación/actualización: `services.manage`, solo super_admin y admin.

## Leads

- internos únicamente para operación;
- `global` consulta todos los leads internos;
- `assigned` usa `assigned_to_user_id=actor.localUserId` sin exigir organización;
- standalone requiere `leads.manage`;
- modos organizacionales requieren además `organizations.manage` y scope cuando reutilizan.

## Organizaciones

Continúan opcionales. Listados transversales requieren `organizations.access_all`; memberships
solo habilitan recursos de su organización. No conceden acceso a recursos standalone.

No existe autorización paralela en handlers.
