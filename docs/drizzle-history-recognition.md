# Reconocimiento de historia Drizzle

Fecha de evidencia: 24 de julio de 2026.

## Implementacion real instalada

Drizzle ORM 0.45.2 usa por defecto:

- schema: `drizzle`;
- tabla: `__drizzle_migrations`;
- columnas: `id serial PRIMARY KEY`, `hash text NOT NULL`,
  `created_at bigint`;
- secuencia implicita: `drizzle.__drizzle_migrations_id_seq`;
- hash: SHA-256 en minusculas de los bytes completos de cada archivo SQL;
- `created_at`: el campo `when` del journal, expuesto como `folderMillis`;
- orden: entradas del journal;
- ultima migracion: fila con mayor `created_at`
  (`ORDER BY created_at DESC LIMIT 1`);
- pendiente: cada migracion cuyo `folderMillis` sea mayor que ese ultimo
  `created_at`.

El migrador divide sentencias por el breakpoint Drizzle, ejecuta las
migraciones pendientes dentro de su transaccion e inserta el hash y timestamp
tras cada archivo. El snapshot modela el estado esperado, pero no determina el
hash ni sustituye el journal.

## Historia fisica reconocida

| Migracion | Archivo | Hash SHA-256 calculado | `created_at` | Efecto fisico verificado |
| --- | --- | --- | ---: | --- |
| 0000 | `0000_ilvox-baseline.sql` | `8684f87db7022b3486879899d249057d0fb879b4b1e703b5d21dd8638a175e48` | 1784755488024 | Si |
| 0001 | `0001_phase3-rbac-separation.sql` | `3ea019ab34c0cf5f2f027f101b9da893a08272a7aa2bf212d979dfc0cc11acb5` | 1784761717416 | Si |
| 0002 | `0002_phase3-file-audience.sql` | `74a5cc43ab82c51397f96e2cac4b5d54dc1f47f9665d66d33d02f4f8419d7741` | 1784761739042 | Si |
| 0003 | `0003_phase3-clerk-event-idempotency.sql` | `7712f9199f43a8a340623172fba32bd3d7e7a82e2818c29d5f6d1efae1465f7e` | 1784761761208 | Si |
| 0004 | `0004_phase4-5-lead-standalone-conversion.sql` | `ea80479b653875a094f6fa9bf5efe09359ec4e29baac7701dd3ab6b29a64e5a3` | 1784834099872 | Si |
| 0005 | `0005_phase4-5-services-manage.sql` | `db2b86ef87450a605b864aa740c6ef0c8660f1da427aee235ce4022bad4b19c9` | 1784834112902 | Si |

El reconocimiento no aplico ninguno de esos archivos. Repitio el preflight
fisico dentro de la misma transaccion, obtuvo advisory lock, creo schema/tabla
exactos e inserto las seis filas en orden. Verifico hashes, timestamps, cero
duplicados y ausencia de 0006-0007 antes de commit.

## Migraciones aplicadas despues

| Migracion | Archivo | Hash SHA-256 calculado | `created_at` |
| --- | --- | --- | ---: |
| 0006 | `0006_phase5-member-revocation.sql` | `68c0c1cf9d2bc896e758b0a21d2fbb81d87475b26148d612efa0252da1c01778` | 1784916239087 |
| 0007 | `0007_phase5-deliverable-milestone.sql` | `379e8964899fdc9153b3311374b8689a393ccbd6f78a3f494dafbf6012120fd4` | 1784916255076 |

La inspeccion posterior al reconocimiento encontro exclusivamente estas dos
migraciones pendientes. El migrador oficial las aplico en orden y agrego las
filas siete y ocho. La verificacion final comparo los ocho registros con los
hashes recalculados y el journal; el segundo migrate fue no-op.

## Uso seguro

Para otro entorno no se deben copiar ciegamente las filas actuales. Primero
deben recalcularse los hashes de los archivos presentes, verificarse todos los
efectos fisicos y repetirse backup, ensayo y preflight. Nunca se debe reconocer
solo 0000, ejecutar la baseline sobre una base poblada ni usar
`drizzle-kit push`.
# Migración versionada de Fase 6

El journal añade `0008_phase6-tickets` con `created_at=1785198997717` y hash
SHA-256 definitivo
`98903f835896224c59767e2723eb0cf2b13d2dd2f2c67dc4dc4cc1aef1945cd6`.
La migración fue aplicada mediante el migrador oficial a
`GestionIlvox.public` el 27 de julio de 2026. El historial persistente final
contiene exactamente 0000-0008, el hash de la novena fila coincide con el
anterior y un segundo migrate fue no-op. La evidencia operativa está en
`docs/phase-6-operational-deployment.md`.
