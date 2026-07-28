# Implementación de Fase 6: tickets

Fecha: 27 de julio de 2026.

## Alcance

Fase 6 implementa exclusivamente tickets y comentarios de tickets:

- tickets standalone privados (`organization_id` y `project_id` nulos);
- tickets organizacionales;
- tickets ligados opcionalmente a un proyecto de la misma organización;
- listado, detalle, edición general, prioridad, asignación, transición y confirmación;
- comentarios cliente e internos según permiso;
- scopes SQL, auditoría transaccional y concurrencia.

No implementa archivos, almacenamiento, URLs, notificaciones, SLA, facturación,
contactos, invitaciones, frontend ni Fase 7.

## Integridad seleccionada

`tickets.project_id` conserva la FK compuesta a `(projects.id,
projects.organization_id)` y añade una FK simple a `projects.id`. El check
`chk_tickets_project_requires_organization` impide un proyecto con organización
nula. En conjunto, la FK simple garantiza existencia y la compuesta garantiza
el mismo tenant.

`ticket_comments.ticket_id` añade una FK simple obligatoria a `tickets.id`.
`organization_id` se vuelve nullable y el trigger
`trg_ticket_comments_derive_organization` lo deriva siempre del ticket padre.
Así una FK compuesta `MATCH SIMPLE` nunca es la única garantía de existencia.

## Identidad y datos protegidos

El solicitante y autor se derivan de `ActorContext.localUserId`, cuya fuente
estable es `app_users.id` asociado a `clerk_user_id`. El body no controla
solicitante, autor, código, número, año, estado inicial, asignación, fechas,
resolución ni cierre. No se usa email como identidad ni metadata Clerk como
autorización.

## Tareas de ticket

No se habilitaron. `tasks` todavía exige un rediseño conjunto de su check de
contexto y la FK compuesta nullable a tickets para soportar con seguridad un
ticket standalone. Forzar la API habría dejado una vía `MATCH SIMPLE`
insuficiente. Esta brecha no bloquea el módulo principal de tickets.

## Migración

`0008_phase6-tickets` incluye preflight, postflight, breakpoints Drizzle,
snapshot y rollback separado. Fue ensayada con el migrador oficial en un
entorno temporal: 19/208/45/59/16/56 y RBAC 11/37/159 antes;
19/208/47/60/16/58 y RBAC 11/39/165 después. El segundo migrate fue no-op y el
rollback restauró los conteos previos. `GestionIlvox.public` no fue modificado.
