# Autorización de Fase 5

La Fase 5 reutiliza exclusivamente `AuthorizationService` para producir
`AuthorizedRepositoryScope`. Los handlers no asignan roles ni permisos y los repositorios no
ofrecen lecturas operativas sin scope.

## Proyectos

- `global`: permiso global efectivo.
- `organization`: `organization_id = ANY(ids concedidos)`.
- `assigned`: organización concedida y `EXISTS project_members` para el actor.
- `public` y `own`: cero filas.

El mismo predicado se usa en lista, búsqueda, conteo, detalle y mutaciones. Un actor interno
con permiso global no necesita una membresía organizacional. Un rol de proyecto obtiene scope
solo para sus proyectos.

## Tareas

- `global`: todas las tareas de Fase 5; las de ticket quedan excluidas.
- `assigned` con organización: membresía del actor en el proyecto.
- `assigned` standalone: `organization_id IS NULL` y actor assignee.
- `own`: actor creador y organización concedida o standalone.
- `public`: cero filas.

`organization_id IS NULL` nunca agrupa tareas en un tenant compartido. Los clientes físicos
no reciben `tasks.read` ni `tasks.manage` en el RBAC vigente y no pueden ver standalone.

## Elegibilidad

- Responsable de proyecto: usuario local activo con rol global interno.
- Miembro de proyecto: usuario local activo; un actor interno puede no tener membership de
  organización, mientras un cliente sí necesita membership activa en esa organización.
- Assignee de proyecto: miembro activo del proyecto.
- Assignee standalone: usuario local activo con rol global.

Las respuestas 404 unifican inexistencia y fuera de scope. Ningún conteo se calcula antes del
predicado autorizado.
