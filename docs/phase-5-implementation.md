# Implementación de Fase 5

Fecha: 23 de julio de 2026.  
Alcance: proyectos ligados a organizaciones y tareas internas standalone o ligadas a proyectos.

## Resultado

La implementación agrega módulos Fastify/TypeScript para:

- proyectos con organización obligatoria, responsable interno, filtros, paginación y orden
  por whitelist;
- asignación y máquina de estados de proyectos;
- alta y cambio de rol de miembros de proyecto;
- hitos y entregables derivados del contexto del proyecto;
- tareas de proyecto y tareas standalone privadas;
- asignación y máquina de estados de tareas;
- scopes SQL en detalle, listado, búsqueda y conteo;
- auditoría transaccional redactada;
- locks de fila y comparación de `expectedUpdatedAt`;
- 23 operaciones nuevas en OpenAPI, para un total de 43.

No se implementaron tickets, comentarios, archivos, URLs, almacenamiento, contactos,
invitaciones, proyectos standalone ni Fase 6.

## Decisiones de integridad

- `projects.organization_id` continúa `NOT NULL`.
- El body nunca controla `created_by_user_id`, organización derivada, estado inicial,
  timestamps de aprobación/completado, roles globales ni permisos.
- `PATCH /projects/:id` no acepta organización, responsable ni estado.
- `PATCH /tasks/:id` no acepta proyecto, organización, ticket, assignee ni estado.
- Las tareas públicas excluyen siempre `ticket_id`; Fase 5 no expone tareas de tickets.
- Una tarea standalone tiene `project_id=ticket_id=organization_id=NULL`; solo actores internos
  con `tasks.manage` global pueden crearla.
- El assignee de una tarea de proyecto debe ser miembro activo del proyecto.
- No hay borrado físico en las rutas de Fase 5.

## Concurrencia

Las mutaciones bloquean la fila padre con `SELECT ... FOR UPDATE`. Las transiciones comparan
el estado observado. Los PATCH y asignaciones aceptan `expectedUpdatedAt`; si otro commit
cambió la fila, responden 409. Crear hitos, entregables o tareas bloquea el proyecto y rechaza
proyectos `delivered` o `cancelled`.

## Brechas demostradas y propuestas no aplicadas

### Revocación histórica de miembros

`project_members` carece de `status`, `revoked_at` y `revoked_by_user_id`. El borrado físico
violaría el requisito de preservar historial, por lo que no se expone revocación.

Propuesta para revisión futura, no creada ni aplicada:

```sql
BEGIN;
ALTER TABLE project_members
  ADD COLUMN status varchar(20) NOT NULL DEFAULT 'active',
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN revoked_by_user_id uuid
    REFERENCES app_users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT chk_project_members_status
    CHECK (status IN ('active', 'revoked')),
  ADD CONSTRAINT chk_project_members_revocation
    CHECK (
      (status = 'active' AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL)
    );
CREATE INDEX idx_project_members_active_user
  ON project_members (user_id, project_id)
  WHERE status = 'active';
COMMIT;
```

Rollback propuesto:

```sql
BEGIN;
DROP INDEX IF EXISTS idx_project_members_active_user;
ALTER TABLE project_members
  DROP CONSTRAINT IF EXISTS chk_project_members_revocation,
  DROP CONSTRAINT IF EXISTS chk_project_members_status,
  DROP COLUMN IF EXISTS revoked_by_user_id,
  DROP COLUMN IF EXISTS revoked_at,
  DROP COLUMN IF EXISTS status;
COMMIT;
```

La migración también tendría que cambiar `IdentityRepository` para considerar únicamente
miembros activos.

### Entregable ligado a hito

`deliverables` no contiene `milestone_id`. No es seguro validar solo organización porque un
hito de otro proyecto puede compartir tenant.

Propuesta para revisión futura, no creada ni aplicada:

```sql
BEGIN;
ALTER TABLE project_milestones
  ADD CONSTRAINT uq_project_milestones_id_project_organization
  UNIQUE (id, project_id, organization_id);
ALTER TABLE deliverables ADD COLUMN milestone_id uuid;
ALTER TABLE deliverables
  ADD CONSTRAINT fk_deliverables_milestone_project
  FOREIGN KEY (milestone_id, project_id, organization_id)
  REFERENCES project_milestones (id, project_id, organization_id)
  ON DELETE RESTRICT;
CREATE INDEX idx_deliverables_milestone ON deliverables (milestone_id);
COMMIT;
```

Rollback propuesto:

```sql
BEGIN;
DROP INDEX IF EXISTS idx_deliverables_milestone;
ALTER TABLE deliverables
  DROP CONSTRAINT IF EXISTS fk_deliverables_milestone_project,
  DROP COLUMN IF EXISTS milestone_id;
ALTER TABLE project_milestones
  DROP CONSTRAINT IF EXISTS uq_project_milestones_id_project_organization;
COMMIT;
```

No se creó archivo de migración, no se ejecutó SQL de propuesta y no se usó
`drizzle-kit push`.
