# Autorización de Fase 5

La Fase 5 usa `AuthorizationService` para producir `AuthorizedRepositoryScope`. Los
repositorios aplican el predicado de autorización antes de listar, contar, buscar o mutar.

## Proyectos

- `global`: permiso global efectivo.
- `organization`: `organization_id` dentro de las organizaciones concedidas.
- `assigned`: organización concedida y membresía de proyecto con `status='active'`.
- `public` y `own`: cero proyectos.

`IdentityRepository` solo materializa roles de proyecto desde membresías activas. Por eso una
revocación confirmada deja de contribuir a ActorContext en la siguiente resolución de
identidad. Las consultas de proyectos, tareas y archivos que derivan acceso de
`project_members` filtran también `status='active'`.

## Tareas

- `global`: tareas de Fase 5, excluyendo tickets.
- `assigned` con organización: miembro activo del proyecto.
- `assigned` standalone: actor asignado y `organization_id IS NULL`.
- `own`: actor creador en organización concedida o standalone.
- `organization`: organización concedida.
- `public`: cero filas.

Los mismos filtros se aplican al conteo y al resultado. Un cliente no recibe acceso a tareas
standalone.

## Elegibilidad

- Responsable: usuario local activo con rol global interno.
- Miembro: usuario local activo y contexto organizacional válido cuando corresponde.
- Assignee de proyecto: miembro activo del proyecto.
- Assignee standalone: usuario local activo con rol global.

Una membresía revocada se conserva como historial, pero no satisface elegibilidad ni scope.
Las respuestas 404 unifican inexistencia y fuera de alcance para evitar filtraciones.
