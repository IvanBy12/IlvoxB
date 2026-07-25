# Revocación histórica de miembros de proyecto

## Modelo

La migración `0006_phase5-member-revocation.sql` agrega a `project_members`:

- `status varchar(20) NOT NULL DEFAULT 'active'`;
- `revoked_at timestamptz`;
- `revoked_by_user_id uuid`.

Constraints:

- `chk_project_members_status`;
- `chk_project_members_revocation`;
- `project_members_revoked_by_user_id_fkey`, con `ON DELETE RESTRICT` y
  `ON UPDATE NO ACTION`.

El índice parcial `idx_project_members_active_user` cubre `(user_id, project_id)` donde
`status='active'`.

## Operación

`POST /api/v1/projects/:projectId/members/:memberId/revoke` requiere `projects.manage`,
resuelve scope, bloquea proyecto y miembro, comprueba opcionalmente `expectedUpdatedAt`,
actualiza estado/actor/fecha y registra `project_member.revoked`.

Una segunda petición sobre el mismo miembro devuelve el estado histórico sin una segunda
mutación ni un segundo evento: la operación es idempotente.

## Efecto de autorización

Solo membresías activas alimentan `IdentityRepository`, ActorContext, scopes assigned de
proyectos y tareas, acceso a archivos derivado del proyecto, listados operativos y
elegibilidad de assignees.

El rollback separado se niega a eliminar el modelo mientras existan filas revocadas. No hay
borrado físico ni reescritura de tareas históricas.
