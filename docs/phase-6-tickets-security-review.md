# Revisión de seguridad de tickets de Fase 6

## Controles aprobados

- solicitante y autor derivados de `app_users.id`;
- bodies cerrados y campos de sistema protegidos;
- 404 uniforme para inexistente/fuera de scope;
- scope dentro de SQL para datos y conteos;
- membership y project membership activas revalidadas en SQL;
- ticket standalone visible solo para su solicitante o actor interno autorizado;
- FK simple para existencia y FK compuesta/check para tenant;
- comentarios derivados del padre mediante trigger;
- locks y control optimista;
- auditoría en la misma transacción sin descripción/comentario completo;
- cero rutas de archivos o URLs.

## Riesgos restantes

- `npm audit` continúa como gate de despliegue público hasta obtener egress;
- edición/borrado de comentarios requiere historial persistente futuro;
- tareas de ticket requieren rediseño estructural antes de habilitarse;
- archivos standalone requieren un modelo de tenant/audiencia distinto;
- la credencial PostgreSQL previamente expuesta debe estar rotada antes de
  cualquier ensayo con cleanup destructivo.
