# Modelo futuro de autorización

Estado: contrato para Fase 3; **no implementado**.

La decisión evalúa identidad autenticada + perfil local activo + rol efectivo + permiso + scope + organización + recurso + estado. Toda ausencia deniega.

Scopes conceptuales: `global`, `organization`, `assigned`, `own`, `public`. `global` no significa control total: el actor también requiere el permiso de acción y, para cruce organizacional, `organizations.access_all`.

## Reglas

1. Resolver el `clerk_user_id` verificado contra `app_users`; ignorar roles/permisos del frontend.
2. Denegar perfiles `pending`, `blocked`, `deleted` o inexistentes.
3. Resolver roles desde `user_roles`, `organization_memberships` y `project_members`.
4. Validar membresía activa, scope y organización real del recurso.
5. Validar ownership/asignación, audiencia y estado/transición.
6. Pasar un scope firmado internamente al repositorio y filtrar en SQL.
7. Auditar operaciones sensibles en la misma transacción.

Los repositorios de tickets, proyectos, tareas, archivos, comentarios, organizaciones, usuarios y auditoría deben exigir contexto. Está prohibido usar `findTicketById(ticketId)` para un actor no global; se requiere una consulta equivalente a `findAuthorizedTicket({ ticketId, organizationId, actorId, scope })`.

Archivos y comentarios heredan organización y visibilidad del padre. `ticket_comments.visibility='client'` permite demostrar audiencia cliente; `files.classification` es sensibilidad, no audiencia. Los adjuntos directos sin señal de audiencia cliente se deniegan a clientes hasta aprobar un campo/política persistente.

## Protecciones privilegiadas

- no autoelevación, autoampliación de scope ni autoaprobación;
- no desactivar/degradar al último superadmin activo;
- locks/transacción/idempotency key para cambios privilegiados;
- reason codes internos redactados al cliente;
- auditoría obligatoria para roles, permisos, seguridad, configuración, acceso transversal, acciones de resolución y archivos sensibles.

Los tipos y el orden de evaluación están especificados en `authorization-service-contract.md`; los filtros en `repository-scope-contract.md`.
