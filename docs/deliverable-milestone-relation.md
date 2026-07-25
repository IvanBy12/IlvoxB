# Relación entregable–hito

La migración `0007_phase5-deliverable-milestone.sql` agrega
`deliverables.milestone_id uuid NULL`.

La integridad se garantiza con:

- `uq_project_milestones_id_project_organization` sobre
  `(id, project_id, organization_id)`;
- `fk_deliverables_milestone_project` desde
  `(milestone_id, project_id, organization_id)` al mismo triple del hito;
- `ON DELETE RESTRICT`, `ON UPDATE NO ACTION`;
- índice `idx_deliverables_milestone`.

Un valor nulo representa un entregable general. Un UUID debe existir dentro del mismo
proyecto y organización. El repositorio valida y bloquea el hito para producir un error de
dominio claro, y PostgreSQL conserva la garantía final ante carreras o bypass.

Create acepta `milestoneId` opcional. PATCH permite UUID o `null`, no permite cambiar
proyecto ni organización y conserva `expectedUpdatedAt` y auditoría transaccional.

El rollback separado se niega a retirar la relación mientras existan entregables vinculados.
