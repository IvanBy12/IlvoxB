# Resultados de pruebas — Fase 3

Fecha de actualización: 23 de julio de 2026.

## Evidencia PostgreSQL conservada

PostgreSQL 18.x es la familia oficial y PostgreSQL 18.4 es la versión runtime validada. Baseline, migraciones, rollback, catálogo, restricciones, Drizzle y 53/53 pruebas con DB aprobaron previamente. PostgreSQL 16 no fue probado, no está soportado oficialmente y no bloquea Fase 4.

Estas pruebas no se repitieron durante el cierre Clerk de Fase 3.5.

## Suite local aprobada

La evidencia histórica vigente incluye:

- typecheck, ESLint y build aprobados;
- 44 pruebas sin DB y 9 integraciones PostgreSQL omitidas en la ejecución local posterior a migraciones;
- 53/53 con PostgreSQL 18.4;
- `db:check`, auditorías SQL/RBAC/paridad y cleanup aprobados;
- 11 roles, 36 permisos y 157 asociaciones distintas, sin fugas sensibles.

## Runtime Clerk Fase 3.5

- Session token real: aceptado.
- Sesión: `active`, sin tarea pendiente después de habilitar `Membership optional`.
- Sin token e inválido: 401.
- Perfil ausente/pending/blocked/deleted: 403.
- `/me`: cliente A/B, multi-org, interno limitado, admin y super_admin aprobados.
- Membresía revocada: excluida del contexto.
- Cross-org: 404.
- Archivo interno para cliente: 404.
- Archivo en cuarentena: 403.
- Cargas permitidas: almacenadas sin URL pública.
- Escalación admin → super_admin: 403 con auditoría requerida.
- Super_admin no puede asignarse a sí mismo; las operaciones sensibles permitidas sobre terceros requieren auditoría.

El token real no se imprimió ni persistió. Se usó un único usuario Clerk y cero organizaciones Clerk. Todos los datos y herramientas temporales fueron eliminados.

## Webhook

La auditoría real previa de `user.created`, `user.updated`, `user.deleted`, duplicados, retry y orden se conserva. Tras rotar el Signing Secret se ejecutó solo el smoke corto solicitado, con creación/eliminación procesadas y limpieza completa.
