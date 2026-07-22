# Estrategia de nombres de constraints

Fecha: 2026-07-22. Estado: aplicada al modelo y metadatos Drizzle; sin DDL ejecutado.

## Decisión

El SQL baseline exacto y el catálogo creado por él son la autoridad sobre nombres físicos. Se aplicó la estrategia A a las 28 claves foráneas y 4 restricciones únicas antes implícitas: cada una se declara mediante `foreignKey({ name, ... })` o `unique(name).on(...)` con el nombre existente en PostgreSQL.

No se eligió una migración de renombrado: el catálogo ya tiene los nombres correctos. La primera comparación contra el snapshot histórico propuso 32 pares `DROP/ADD`; ese SQL no se ejecutó y se eliminó. El snapshot inicial se corrigió solo en sus 32 campos nominales, preservando identidad, estructura y la baseline SQL byte a byte. Una segunda generación devolvió `No schema changes, nothing to migrate`.

## Responsabilidad

- Drizzle representa estructural y nominalmente 43 FK, 15 UNIQUE, 55 CHECK y 53 índices explícitos.
- La baseline SQL administra `pgcrypto`, orden transaccional, semilla RBAC y reconocimiento operacional.
- Los nombres históricos `*_fkey` y `*_key` son explícitos; no dependen del algoritmo de una versión futura del ORM.
- `drizzle/migrations/0000_ilvox-baseline.sql` sigue siendo una guarda, no una recreación.

## Migraciones futuras

1. Ejecutar `db:check`, `audit:parity` y `audit:constraint-names`.
2. Revisar todo `DROP`, cambio de nullabilidad, tipo o recreación de constraint.
3. Rechazar un `DROP/ADD` cuyo único cambio sea un nombre ya existente en catálogo.
4. Nombrar explícitamente todo constraint nuevo en Drizzle y SQL.
5. No usar `drizzle-kit push` en bases con datos. Una operación destructiva requiere respaldo probado, evaluación de bloqueos/dependencias y rollback revisado.

## Rollback

Un rollback debe tomar el nombre verificado en `pg_constraint`, nunca inferirlo:

```sql
SELECT conrelid::regclass AS table_name, conname, contype,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname = :constraint_name;
```

Antes de `DROP CONSTRAINT`, comprobar tabla, columnas, destino y acciones. Para un cambio solo nominal, considerar `RENAME CONSTRAINT` únicamente si el catálogo realmente lo necesita. Recrear una UNIQUE también recrea su índice físico y puede bloquear escrituras.

## Verificación predestructiva

- servidor, base, esquema y versión;
- checksum de baseline y dependencias de catálogo;
- duplicados de datos antes de crear UNIQUE;
- 43 FK: 41 `RESTRICT`, 2 `CASCADE`, 43 `NO ACTION` en actualización;
- 15 UNIQUE y cero índices físicos equivalentes duplicados;
- “No schema changes” tras alinear snapshot/modelo.

PostgreSQL 16 continúa pendiente; la evidencia runtime actual es PostgreSQL 18.4.
