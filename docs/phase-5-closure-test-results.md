# Resultados del cierre operativo de Fase 5

Fecha: 24 de julio de 2026. Runtime PostgreSQL: 18.4.

| Verificacion | Resultado |
| --- | --- |
| Ensayo en base temporal | Aprobado; reconocimiento 0000-0005, solo 0006-0007 aplicadas, segundo migrate no-op, rollback y cleanup |
| Reconocimiento en `public` | Aprobado; seis filas exactas, orden, hashes y timestamps reales |
| Migracion oficial | Aprobado; aplico exclusivamente 0006 y 0007 |
| `npm.cmd run check` | Aprobado: TypeScript, ESLint, 87 pruebas locales, auditor 6/6 y build |
| `npm.cmd run test:database -- --database-url` | Aprobado: 126/126, 20 archivos |
| `npm.cmd run db:check` | Aprobado |
| `db:validate:runtime -- --database-url` | Aprobado; baseline, catalogo, constraints, FK, identity, rollback y cleanup |
| `db:validate:phase3 -- --database-url` | Aprobado; apply, rollback y cleanup |
| `db:validate:phase45 -- --database-url` | Aprobado; apply, rollback y cleanup |
| `db:validate:phase5-closure -- --database-url` | Aprobado; FK negativa `23503`, guardas, rollback y cleanup |
| `audit:sql` | Aprobado; estado `phase5_closure`, 19/208/45/59/16/56 |
| `audit:rbac` | Aprobado; 11/37/159, sin leaks |
| `audit:parity` | Aprobado |
| `audit:constraint-names` | Aprobado; estado aplicado, sin duplicados ni schemas temporales |
| OpenAPI | 0.5.1; 44 operaciones |
| `npm audit --omit=dev` / `npm audit` | Inconcluso: endpoint inaccesible; no se ejecuto fix forzado |

## Smokes reales

La revocacion devolvio `200` en el primer intento y en el reintento idempotente.
Persistio un solo evento de auditoria, se conservo la membresia historica y el
usuario local, se retiro inmediatamente el acceso a proyecto, tarea y archivo,
y otro miembro activo conservo su acceso.

La relacion entregable-hito aprobo creacion, `milestoneId=null` y reasignacion.
El hito de otro proyecto fue rechazado de forma segura por HTTP; un insert SQL
directo cruzado devolvio `23503`. Campos protegidos de proyecto/organizacion
fueron rechazados, el proyecto cerrado devolvio `409` y la carrera concurrente
produjo un resultado consistente `[200, 409]`.

## Limpieza

El conteo posterior fue cero para usuarios temporales con prefijo de smoke,
organizaciones de smoke, proyectos, tareas, archivos, entregables e hitos.
Los cinco usuarios locales preexistentes se preservaron. No quedaron schemas
temporales ni se crearon usuarios o sesiones Clerk.
