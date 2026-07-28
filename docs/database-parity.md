# Paridad PostgreSQL, SQL original y Drizzle

> Actualizacion operativa del 24 de julio de 2026: el procedimiento seguro se
> completo en `GestionIlvox.public`. La historia reconoce exactamente
> 0000-0007; 0000-0005 se registraron de forma transaccional sin reaplicar su
> DDL y el migrador oficial aplico solo 0006-0007. El catalogo final es
> 19/208/45/59/16/56 y RBAC permanece 11/37/159. Cualquier seccion historica
> que describa la tabla como ausente o proponga reconocer solo 0000 queda
> anulada por `docs/drizzle-history-recognition.md`.

Fecha: 2026-07-22  
Estado: comparación estática y catálogo real completados en PostgreSQL 18.4, runtime oficial de PostgreSQL 18.x.
Fuente de verdad: `C:\Users\leopa\Downloads\ilvox_complete_reconstructed.sql`.

## Baseline preservada

La copia versionada está en `drizzle/baseline/0000_ilvox_complete_reconstructed.sql`. Es byte a byte idéntica al archivo recibido:

- tamaño: 40.731 bytes;
- SHA-256: `46D9EDDF29A0ABC25091E43867D0AC6B11A1AE180BDDF12665254BE9CD178CD6`;
- incluye `pgcrypto`, las 19 tablas, restricciones, índices y la semilla RBAC;
- el archivo original en `Downloads` no fue modificado.

`drizzle/migrations/0000_ilvox-baseline.sql` no contiene DDL. Es una guarda que lanza una excepción deliberada. Su snapshot permite que las migraciones posteriores se generen desde el esquema actual, pero impide que `drizzle-kit migrate` intente recrear tablas si la baseline no fue reconocida primero.

## Resultado de la comparación

Se ejecutaron `drizzle-kit export` y `scripts/audit-drizzle-parity.mjs` contra el SQL original.

Además, el SQL original se ejecutó sin editar en un esquema temporal aislado de PostgreSQL 18.4. El catálogo real confirmó 19 tablas, 199 columnas, 19 PK, 15 UNIQUE, 43 FK, 55 CHECK, una identity, una columna generada y 87 índices físicos.

| Elemento | SQL original | Drizzle exportado | Resultado |
| --- | ---: | ---: | --- |
| Tablas | 19 | 19 | Coincide |
| Columnas | 199 | 199 | Coinciden nombres, tipos, longitudes y nullabilidad en el mapeo |
| Índices explícitos | 53 | 53 | Coinciden nombres, columnas, orden y predicados |
| Restricciones `CHECK` nombradas | 55 | 55 | Coinciden nombres y expresiones |
| Referencias FK | 43 | 43 | Coinciden columnas y tablas destino |
| FK compuestas nombradas | 15 | 15 | Coinciden nombres y pares de columnas |
| `UNIQUE` nombradas con prefijo `uq_` | 11 | 11 | Coinciden |
| Columnas identity | 1 | 1 | `tickets.ticket_number` |
| Columnas generadas almacenadas | 1 | 1 | `tickets.code` |
| Tipos enum o dominios PostgreSQL | 0 | 0 | No existen |
| Roles de semilla | 11 | No aplica al modelo ORM | Conservados en la baseline explícita |
| Permisos de semilla | 23 | No aplica al modelo ORM | Conservados en la baseline explícita |
| Asociaciones rol-permiso | 142 distintas | No aplica al modelo ORM | Conservadas en la baseline explícita |

### Drift nominal resuelto en Fase 2.5

La estructura y el comportamiento ya coincidían. Las 32 diferencias históricas de **nombre físico** fueron resueltas el 2026-07-22:

- 28 FK se declaran ahora con `foreignKey({ name: <nombre *_fkey> })`.
- 4 restricciones `UNIQUE` se declaran con `unique(<nombre *_key>).on(...)`; continúan siendo constraints, no índices sueltos.
- Las 15 FK compuestas nombradas y las 11 UNIQUE con prefijo `uq_` sí conservan su nombre exacto.

No hay drift nominal ni estructural. La primera comparación contra el snapshot antiguo propuso 32 `DROP/ADD`; no se aplicó ni conservó. Se corrigieron solo los nombres del snapshot inicial y la siguiente generación devolvió `No schema changes, nothing to migrate`. Véanse `constraint-name-mapping.md` y `constraint-naming-strategy.md`.

### Índices físicos reales

El catálogo resolvió la diferencia histórica:

- 53 índices explícitos: 52 `CREATE INDEX` + 1 `CREATE UNIQUE INDEX` parcial;
- 19 índices implícitos de primary key;
- 15 índices implícitos de restricciones UNIQUE;
- total físico real: **87**.

La cifra 74 no corresponde al catálogo. Equivale numéricamente a 53 + 19 + 2 y, por tanto, omitió 13 de los 15 índices UNIQUE implícitos. Los índices parciales y de expresión ya forman parte de los 53 explícitos; las FK no crean índices automáticamente.

Las 199 columnas por tabla son: `app_users` 10, `roles` 7, `permissions` 7, `role_permissions` 3, `user_roles` 5, `identity_webhook_events` 9, `organizations` 12, `organization_memberships` 11, `services` 8, `leads` 14, `projects` 13, `project_members` 9, `project_milestones` 10, `deliverables` 10, `tickets` 19, `ticket_comments` 8, `tasks` 14, `files` 18 y `audit_events` 12.

### Tipos, defaults y claves

- `uuid`, `varchar(n)`, `char(n)`, `text`, `boolean`, `integer`, `smallint`, `bigint`, `date`, `timestamptz`, `jsonb` e `inet` mantienen su tipo PostgreSQL.
- Los modos TypeScript (`date` como string y `bigint` como `bigint`) solo afectan el valor recibido por la aplicación, no el DDL.
- Se conservan `gen_random_uuid()`, `now()`, literales, expresiones de fecha y todos los defaults del SQL.
- Se conservan las PK simples y compuestas, las FK simples y compuestas, y todas las restricciones únicas.
- Las 41 FK `RESTRICT` y las 2 FK `CASCADE` conservan `ON DELETE`.
- El SQL no declara `ON UPDATE`; PostgreSQL aplica `NO ACTION`. Drizzle exporta ese mismo comportamiento predeterminado.

### Checks, índices y valores enumerados

- Los 55 `CHECK` permanecen como SQL explícito, incluidos regex, `num_nonnulls`, `jsonb_typeof` e invariantes de timestamps.
- Los arrays `enum` usados en columnas `varchar` mejoran la inferencia TypeScript, pero no crean un tipo enum PostgreSQL. La autoridad en base de datos sigue siendo cada `CHECK`.
- Se mantienen índices de expresión (`lower(...)`), parciales y únicos parciales.
- Drizzle hace explícito el orden de nulos al exportar columnas descendentes. Todas las columnas descendentes del esquema son `NOT NULL`; por ello no cambia el conjunto ni el orden efectivo respecto de `DESC` en el SQL original.

### Elementos mantenidos mediante SQL explícito

Drizzle no sustituye los siguientes elementos:

- `CREATE EXTENSION IF NOT EXISTS pgcrypto`;
- las dos transacciones y el orden operacional del SQL original;
- la semilla RBAC y su `ON CONFLICT`;
- la consulta informativa final;
- la política de reconocimiento de baseline.

Estos elementos permanecen en la copia exacta de la baseline. La expresión de `tickets.code` y los defaults no triviales se representan en Drizzle mediante fragmentos `sql` explícitos, sin reescribirlos.

## Escenario A: base nueva

Precondiciones: PostgreSQL 18.x, base dedicada vacía, permiso para `pgcrypto`, checksum verificado y credenciales que no apunten a producción. Otra versión exige una validación específica previa.

1. Verificar el checksum de `drizzle/baseline/0000_ilvox_complete_reconstructed.sql`.
2. Crear una base vacía con nombre explícito.
3. Ejecutar la baseline con `ON_ERROR_STOP=1` usando `psql`; no usar `drizzle-kit push`.
4. Si cualquier bloque falla, descartar esa base nueva y comenzar de nuevo. El SQL contiene dos transacciones, así que no debe asumirse atomicidad global entre esquema y semilla.
5. Comparar catálogos, restricciones, índices y conteos de semilla según `docs/database-validation.md`.
6. Solo tras demostrar paridad, registrar la baseline Drizzle mediante el procedimiento controlado de la sección siguiente.
7. Ejecutar después únicamente migraciones posteriores revisadas.

Ejemplo:

```powershell
$baseline = 'drizzle\baseline\0000_ilvox_complete_reconstructed.sql'
Get-FileHash -Algorithm SHA256 $baseline
createdb --maintenance-db=postgres ilvox_new
psql --dbname=ilvox_new --set=ON_ERROR_STOP=1 --file=$baseline
```

No se creó una base vacía ni se marcó la baseline. La prueba runtime se hizo en un esquema temporal aislado y luego eliminado; no autoriza reconocer la baseline de una base existente.

## Escenario B: base existente

**Nunca se ejecuta la baseline sobre una base que ya contiene las tablas.** Reconocerla equivale a declarar que esa base ya satisface el snapshot; no corrige diferencias.

Antes de marcar:

1. tomar respaldo y disponer de restauración probada;
2. confirmar versión, base, servidor y esquema objetivo;
3. verificar las 19 tablas y las 199 columnas mediante catálogos;
4. comparar tipos, longitudes, nullabilidad, defaults, PK, FK, acciones, unique, checks, índices y columnas generadas;
5. validar 11 roles, 23 permisos y 142 asociaciones distintas;
6. confirmar que no existe una historia Drizzle incompatible ni una migración con timestamp posterior;
7. revisar el checksum actual de la guarda y el valor `when` de `drizzle/migrations/meta/_journal.json`.

La implementación actual de Drizzle decide qué omitir por `created_at`; el hash se almacena, pero no se usa para volver a verificar una migración ya registrada. Por eso insertar una fila sin las comprobaciones anteriores puede ocultar drift y provocar fallos o pérdida de datos en migraciones futuras.

Reconocer una unica marca 0000 es incorrecto cuando los efectos posteriores ya
existen. El 24 de julio de 2026 el procedimiento operacional verifico y
registro en una sola transaccion las seis migraciones fisicamente presentes,
0000-0005, con los hashes recalculados y los timestamps del journal. El detalle
exacto y el runbook portable estan en `docs/drizzle-history-recognition.md`;
no se conserva aqui una plantilla SQL parcial que pueda ocultar drift.

## Comandos de comprobación

```powershell
npm run db:export
npm run audit:parity -- C:\ruta\ilvox_complete_reconstructed.sql
npm run audit:sql -- C:\ruta\ilvox_complete_reconstructed.sql
npm run audit:rbac -- C:\ruta\ilvox_complete_reconstructed.sql
```

`drizzle-kit push` queda prohibido para bases con datos. El migrador oficial
solo debe ejecutarse despues de verificar una historia completa y coherente.

## Pendiente

- Mantener staging y producción en PostgreSQL 18.x; revalidar completamente antes de adoptar otra versión.
- Mantener la auditoría exacta de nombres con `npm run audit:constraint-names` antes de futuras migraciones.
- Recalcular y registrar evidencia de baseline en cada entorno real antes de habilitar migraciones posteriores.

## Estado del cierre de Fase 5

Las migraciones 0006 y 0007 fueron ensayadas y despues aplicadas a `public`
mediante el migrador oficial. El catalogo persistente es
19/208/45/59/16/56. La FK compuesta rechazo vinculos entre proyectos, las
guardas de rollback aprobaron en el entorno temporal, el segundo migrate fue
no-op y todos los entornos temporales fueron eliminados.

`audit:constraint-names` reporta ahora `phase5_closure` aplicado, sin drift,
constraints o indices duplicados.

## Estado tras la preintegración de Fase 3.5

La baseline versionada volvió a producir el SHA-256 aprobado y las auditorías estáticas aprobaron. La paridad exportada mantiene 19 tablas y 43 referencias FK; reconoce como únicas diferencias esperadas de Fase 3 el índice `idx_files_organization_audience_active` y los checks `chk_files_audience` y `chk_identity_webhook_events_payload_sha256`.

PostgreSQL 18.4 es la evidencia runtime oficial, con tiempo de baseline registrado de 230.97 ms. PostgreSQL 16 no fue probado ni está soportado oficialmente; su ausencia no es un gate. Esta decisión no autoriza reconocer/aplicar la baseline en una base principal sin completar el runbook y las aprobaciones correspondientes.

## Estado tras Fase 4.5

Las migraciones 0004–0005 se validaron sobre baseline + 0001–0003 en un schema temporal de
PostgreSQL 18.x:

- 19 tablas, 204 columnas, 43 FK, 57 checks, 15 unique y 54 índices explícitos;
- 11 roles, 37 permisos y 159 asociaciones distintas;
- `services.manage`: dos grants, cero grants no autorizados;
- `chk_leads_conversion` conserva nombre y FK a organizaciones, permitiendo organización
  nula únicamente cuando status es converted y converted_at existe;
- rollback 0005 restauró 36/157;
- rollback 0004 rechazó correctamente datos standalone y luego restauró el check antiguo
  tras limpiar el fixture;
- schema temporal eliminado y fingerprint de `public` sin cambios.

El cambio de expresión del check está reflejado en el snapshot 0004. El snapshot custom 0005
no cambia estructura porque esa migración modifica datos RBAC.

## Estado persistente después del despliegue de Fase 4.5

El 23 de julio de 2026 se aplicaron 0004 y 0005 sobre `GestionIlvox.public`, después de crear y
verificar un backup custom. El catálogo persistente confirmó 19 tablas, 204 columnas, 43 FK,
57 checks, 15 unique y 54 índices explícitos. RBAC confirmó 11 roles, 37 permisos y 159
asociaciones distintas.

`audit:constraint-names` ya no conserva los conteos históricos 19/199/55/23/142. Obtiene los
nombres esperados de la exportación Drizzle, compara CHECK/FK/UNIQUE físicos y acepta
explícitamente las variantes pre y post 0004 de `chk_leads_conversion`. Después del despliegue
reportó fase `phase45`, cero faltantes, cero inesperados, cero índices duplicados y cero schemas
temporales.

Las auditorías SQL/RBAC conservan la lectura deliberada de la baseline histórica y, cuando
existe `DATABASE_URL`, añaden una transacción read-only contra el estado vigente. El resultado
final fue catálogo 19/204/43/57/15/54 y RBAC 11/37/159, sin duplicados, huérfanos ni leaks.
0005 sigue siendo una migración de datos y no altera el SQL de baseline.

## Estado persistente despues del cierre operativo de Fase 5

El 24 de julio de 2026 se creo y verifico un backup custom de PostgreSQL y se
ensayo el flujo completo en una base temporal. El ensayo reconocio 0000-0005
sin ejecutar su DDL, aplico solo 0006-0007 mediante el migrador oficial,
confirmo un segundo migrate no-op, probo los rollbacks controlados y elimino la
base temporal.

El mismo reconocimiento se ejecuto despues en `GestionIlvox.public` dentro de
una sola transaccion con advisory lock y preflight fisico repetido. El historial
final contiene ocho filas exactas y el catalogo persistente confirma:

- 19 tablas y 208 columnas;
- 45 foreign keys, 59 checks y 16 unique;
- 56 indices explicitos;
- 11 roles, 37 permisos y 159 asociaciones RBAC distintas;
- cero drift, constraints duplicados, indices duplicados o schemas temporales.

Los hashes y timestamps definitivos, junto con la estructura real de
`drizzle.__drizzle_migrations`, se documentan en
`docs/drizzle-history-recognition.md`. La evidencia de backup, ensayo,
postflight, smokes y limpieza esta en
`docs/phase-5-operational-deployment.md`.
# Modelo esperado de Fase 6

La migración 0008 añade, sin aplicarse todavía a `GestionIlvox.public`, dos FKs
simples (`fk_tickets_project_id`, `fk_ticket_comments_ticket_id`), un check,
dos índices y un trigger de derivación de organización de comentarios. El
snapshot esperado conserva 19 tablas/208 columnas y pasa a 47 FK, 60 CHECK, 16
UNIQUE y 58 índices explícitos. RBAC esperado: 11 roles, 39 permisos y 165
asociaciones.

La paridad estática distingue esos artefactos versionados pendientes del drift.
