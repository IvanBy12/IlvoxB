# Implementación de Fase 5

Fecha de cierre técnico: 24 de julio de 2026.

La Fase 5 cubre proyectos ligados obligatoriamente a organizaciones, responsables y miembros,
hitos, entregables, tareas de proyecto y tareas internas standalone. Incluye scopes SQL,
auditoría transaccional, máquinas de estado y control de concurrencia mediante locks y
`expectedUpdatedAt`.

El cierre técnico añade:

- revocación histórica de miembros con estado `active|revoked`, actor y fecha;
- exclusión inmediata de miembros revocados en identidad, scopes, acceso a tareas, listados
  activos y elegibilidad;
- endpoint idempotente `POST /projects/:projectId/members/:memberId/revoke`;
- relación opcional `deliverables.milestone_id`;
- FK compuesta que exige que el hito pertenezca al mismo proyecto y organización;
- soporte para asignar o retirar un hito desde create/PATCH;
- pruebas focalizadas HTTP y PostgreSQL;
- OpenAPI 0.5.1 con 44 operaciones totales, 24 de Fase 5.

Las migraciones 0006 y 0007 están versionadas y validadas con sus rollbacks en schemas
temporales. No se aplicaron a `GestionIlvox.public`.

No se implementaron tickets, comentarios, archivos, almacenamiento, invitaciones, proyectos
standalone ni ninguna funcionalidad de Fase 6.

## Integridad y concurrencia

- `projects.organization_id` continúa `NOT NULL`.
- Proyecto y organización de hitos y entregables se derivan del contexto autorizado.
- El body no controla campos de tenant, creación, aprobación o revocación.
- La revocación bloquea la fila del miembro, es idempotente y conserva el registro.
- Los PATCH de miembros, proyectos, hitos, entregables y tareas usan versión esperada.
- Un proyecto cerrado rechaza nuevas mutaciones derivadas.
- No hay borrado físico en las rutas de Fase 5.

Véanse `project-member-revocation.md`, `deliverable-milestone-relation.md` y
`phase-5-closure.md`.
