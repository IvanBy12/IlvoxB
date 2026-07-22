# Migración RBAC de Fase 3

Migración: `drizzle/migrations/0001_phase3-rbac-separation.sql`  
Rollback: `drizzle/rollbacks/0001_phase3-rbac-separation.down.sql`

La migración verifica primero la baseline exacta de 11 roles, 23 permisos y 142 asociaciones distintas. Inserta los 13 permisos aprobados mediante códigos naturales, retira exactamente 11 asociaciones y agrega exactamente 26 sin duplicados. Las guardas finales exigen 36 permisos, 157 asociaciones distintas y exclusividad de los cinco permisos sensibles para `global:super_admin`.

No se eliminan roles ni permisos históricos. Una baseline inesperada aborta con un error explícito. El rollback valida el estado de Fase 3, revierte únicamente la matriz aprobada y exige volver a 23 permisos y 142 asociaciones.

Validación del 22 de julio de 2026: aplicada sobre una copia limpia en el esquema temporal `ilvox_phase3_e5e7e7c82c54`, seguida por rollback y eliminación del esquema. No se aplicó a `public`.
