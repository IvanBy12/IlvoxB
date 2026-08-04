# Fase 7.5C — Implementación interna de Prospectos y Tickets

Fecha: 4 de agosto de 2026.

## Alcance ejecutado

La ejecución partió de 7.5A y 7.5B cerradas y de árboles Git limpios. Se migraron
exclusivamente `/app/prospectos`, `/app/prospectos/:id`, `/app/tickets` y
`/app/tickets/:id`. Personal, Fase 7.6 y nuevas capacidades del portal quedaron fuera.

El frontend dejó de usar `AppStore`, `seed.ts`, Kanban local y mutaciones de memoria en
estas superficies. `useInternalApi` expone ahora clientes tipados de leads y tickets
construidos sobre el cliente HTTP común, token Bearer fresco y envelopes reales.

## Prospectos

- listado remoto con búsqueda, estado, paginación y orden;
- ruta canónica `/app/prospectos/:id` con datos comerciales e historial;
- `PATCH` limitado a campos comerciales, sin mezclar estado o asignación;
- transiciones adyacentes derivadas de `lead-transitions.ts`, con motivo obligatorio al
  entrar o salir de `not_approved`;
- asignación solo a candidatos conocidos: usuario autenticado y responsable actual;
- desasignación diferida porque `LeadAssignmentBodySchema` exige UUID y no admite `null`;
- conversión `standalone`, `create_organization` y `reuse_organization`;
- crear/reusar organización solo aparece con `organizations.manage`; standalone requiere
  únicamente `leads.manage`;
- 409 conserva el formulario o motivo, hace refetch y no reintenta mutaciones.

## Tickets internos y comentarios

El listado consume filtros remotos de estado, prioridad y búsqueda. El detalle separa:

- edición de `subject`, `description` y `requestedPriority` con `expectedUpdatedAt`;
- asignar/desasignar mediante `/assign`;
- prioridad operativa mediante `/priority`, distinta de la solicitada;
- estado/resolución/cierre mediante `/transition` y targets adyacentes;
- `resolution` obligatoria al resolver y `reason` al cancelar o reabrir;
- comentarios mediante los endpoints dedicados.

Los candidatos de asignación se limitan a la identidad autenticada, responsable actual,
líder y miembros activos del proyecto cuando ese contexto existe. No se creó un catálogo
general ni se consultó Clerk para usuarios.

La UI deriva capacidades de `effectivePermissions`, no de nombres de rol. El permiso de
transición depende del target: `tickets.resolve`, `tickets.close` o
`tickets.change_status`. Edición, asignación, prioridad y comentarios usan sus permisos
específicos.

Un comentario interno envía explícitamente `visibility: "internal"`; uno visible al
cliente envía `visibility: "client"`. El cliente portal conserva
`assertClientOnlyComments` y `ConnectedTicketDetail` no consulta conversación cuando la
identidad también es interna. La seguridad principal sigue en backend: sin
`ticket_comments.read_internal`, la respuesta solo contiene comentarios cliente.

## Errores, concurrencia y presentación

Las mutaciones usan `retry: false`, bloqueo de doble submit y mensajes con `requestId`.
Los 403/404 de detalle se muestran como recurso neutral; ante 409 se conserva texto,
motivo o solución y se refresca la versión del recurso.

La inspección real cubrió 360, 768, 1024 y 1440 px en ambos listados y los estados de
detalle no disponible. No hubo overflow de documento. Se corrigió el único control sin
nombre accesible añadiendo `aria-label` al menú de sesión del layout interno.

## Backend y límites

No se modificaron tablas, migraciones, RBAC persistido, OpenAPI, servicios o repositorios
de dominio. El único código backend añadido es el smoke controlado 7.5C y su script npm.
No se ejecutaron operaciones Git de escritura ni `npm audit fix`.

Personal, catálogo general de usuarios, SLA, archivos, chat, facturación, auditoría
funcional y métricas definitivas permanecen diferidos u ocultos.
