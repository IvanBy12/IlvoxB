# Resultados de pruebas — Fase 3

Fecha: 22 de julio de 2026.

## Suite

- `npm run check`: typecheck, lint, pruebas sin DB y build correctos.
- Pruebas sin DB: 35 aprobadas; 9 integraciones PostgreSQL omitidas intencionalmente.
- `npm run test:database -- --database-url`: 44 de 44 pruebas aprobadas, incluidos los esquemas temporales PostgreSQL.
- `npm run db:check`: historial Drizzle válido.
- `npm run audit:sql`, `audit:rbac` y `audit:parity`: correctos; parity reconoce únicamente el índice y dos checks esperados de Fase 3.

Cobertura funcional: 401 por token ausente/inválido/expirado, perfiles locales no autorizados, `/me` interno/cliente/multi-organización, firma webhook real, payload alterado, duplicados secuenciales y concurrentes, orden de eventos, tombstones, rollback/retry, aislamiento A/B, scopes global/organization/assigned/own/public, count/search/paginación/agregación, escalación privilegiada, último superadmin, intenciones de tickets y audiencia/metadata/almacenamiento de archivos.

## Migración temporal

El esquema `ilvox_phase3_e5e7e7c82c54` produjo 19 tablas, 204 columnas, 43 FKs, 57 checks, 15 unique constraints y 54 índices explícitos. RBAC terminó en 11 roles, 36 permisos y 157 asociaciones distintas, sin duplicados ni fugas sensibles. El rollback volvió a 199 columnas, 55 checks, 53 índices, 23 permisos y 142 asociaciones. `publicUnchanged=true` y `cleanup=true`.

La comprobación final `db:check:phase3-cleanup` encontró cero esquemas `ilvox_phase3_%` residuales.

PostgreSQL 16 no fue utilizado ni validado; estos resultados corresponden al runtime disponible configurado por `DATABASE_URL`.
