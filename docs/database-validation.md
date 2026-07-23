# Validación del SQL original

Fecha: 2026-07-22  
Archivo: `C:\Users\leopa\Downloads\ilvox_complete_reconstructed.sql`  
SHA-256: `46D9EDDF29A0ABC25091E43867D0AC6B11A1AE180BDDF12665254BE9CD178CD6`  
Tamaño leído: 40.731 bytes.

## Estado inequívoco

| Tipo de validación | Estado | Resultado |
| --- | --- | --- |
| Validación estática | Completada | Sin duplicados estructurales, referencias desconocidas ni referencias hacia tablas todavía no creadas |
| PostgreSQL 18.4 oficial | Completada | Esquema temporal aislado, SQL original aplicado correctamente |
| PostgreSQL 16 | No evaluada | No probado, no soportado oficialmente y no bloqueante |
| Pruebas positivas/negativas de `CHECK` | Completadas | 55/55 aprobadas con restricción esperada y rollback |
| Pruebas de claves foráneas | Completadas | 43/43; 41 RESTRICT, 2 CASCADE y NO ACTION comprobados |
| Rollback real | Completado | Inserción, actualización, eliminación y operación multitabla |
| Consulta de catálogos y paridad real | Completada en PostgreSQL 18.4 | 19 tablas, 199 columnas y 87 índices físicos |

**El SQL fue validado en ejecución sobre PostgreSQL 18.4, evidencia runtime oficial de PostgreSQL 18.x. PostgreSQL 16 no fue probado y no se afirma compatibilidad.**

## Nuevo intento de validación runtime

El primer intento se bloqueó porque `TEST_DATABASE_URL` no estaba disponible. Después, el usuario autorizó la `DATABASE_URL` local y corrigió sus credenciales. La conexión sanitizada confirmó PostgreSQL 18.4 y una base con 19 tablas existentes en `public`. Para no sobrescribirlas se creó un esquema temporal aleatorio, se ejecutó allí el SQL original y se eliminó únicamente ese esquema. La evidencia estructurada está en `database-runtime-validation-results.json` y el detalle en `database-runtime-validation.md`.

## Detección del entorno

Resultados:

- `psql` no estaba en `PATH`.
- No se detectaron Docker ni Podman.
- No existían `DATABASE_URL`, `POSTGRES_URL`, `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` ni `PGPASSWORD` en el entorno del proceso.
- Existe el servicio Windows `postgresql-x64-18` en ejecución.
- El binario `O:\postgresql\bin\psql.exe` informa PostgreSQL 18.4.
- Los intentos sin prompt, con usuario por defecto y con `postgres`, fallaron con `fe_sendauth: no password supplied`.
- No se inspeccionaron almacenes de credenciales ni se instalaron herramientas.

Comandos usados:

```powershell
Get-Command psql,postgres,pg_ctl,docker,podman -ErrorAction SilentlyContinue
Get-Service | Where-Object { $_.Name -match 'postgres|docker' }
sc.exe qc postgresql-x64-18
& 'O:\postgresql\bin\psql.exe' --version
$env:PGCONNECT_TIMEOUT='3'
& 'O:\postgresql\bin\psql.exe' -w -d postgres -Atqc 'select current_user, current_setting(''server_version'');'
& 'O:\postgresql\bin\psql.exe' -w -U postgres -d postgres -Atqc 'select current_user, current_setting(''server_version'');'
```

## Validación estática completada

Se ejecutó:

```powershell
node scripts/audit-sql.mjs C:\Users\leopa\Downloads\ilvox_complete_reconstructed.sql
node scripts/audit-rbac.mjs C:\Users\leopa\Downloads\ilvox_complete_reconstructed.sql
```

Resultado estructural:

| Elemento | Cantidad/resultado |
| --- | ---: |
| Bloques `BEGIN` / `COMMIT` | 2 / 2 |
| Extensiones | `pgcrypto` |
| Tablas | 19 |
| Índices explícitos | 53 |
| Referencias FK | 43 |
| Restricciones `CHECK` | 55 |
| Constraints nombradas | 81 |
| `ON DELETE RESTRICT` explícitos | 41 |
| `ON DELETE CASCADE` explícitos | 2 |
| `ON UPDATE` explícitos | 0; aplica `NO ACTION` predeterminado |
| Columnas identity | 1 (`tickets.ticket_number`) |
| Columnas generadas almacenadas | 1 (`tickets.code`) |
| `CREATE TYPE`/dominios | 0 |
| Tablas, índices o constraints nombradas duplicadas | 0 |
| Referencias a tablas desconocidas | 0 |
| Referencias hacia tablas creadas posteriormente | 0 |

Orden de tablas confirmado:

1. `app_users`
2. `roles`
3. `permissions`
4. `role_permissions`
5. `user_roles`
6. `identity_webhook_events`
7. `organizations`
8. `organization_memberships`
9. `services`
10. `leads`
11. `projects`
12. `project_members`
13. `project_milestones`
14. `deliverables`
15. `tickets`
16. `ticket_comments`
17. `tasks`
18. `files`
19. `audit_events`

La semilla contiene 11 roles, 23 permisos y 142 asociaciones distintas. Su auditoría semántica está en `rbac-audit.md`.

## Observación estática histórica sobre PostgreSQL 16

La auditoría estática observó construcciones conocidas por PostgreSQL 16: UUID con `pgcrypto`, columnas identity, columnas generadas `STORED`, `num_nonnulls`, JSONB, `inet`, índices parciales y expresiones en índices. Esta observación no constituye prueba ni soporte oficial.

La ejecución en PostgreSQL 18.4 confirmó expresión generada, FK compuestas, índices, semilla, 55 CHECK y rollback. Esto no demuestra PostgreSQL 16, cuya compatibilidad permanece desconocida y no bloqueante.

## Guía histórica para validar una versión diferente

No ejecutar esta guía para PostgreSQL 16 bajo la política vigente. Solo se reactiva tras una nueva decisión arquitectónica que seleccione una versión fuera de PostgreSQL 18.x.

### Precondiciones

- La versión concreta aprobada por la nueva decisión y sus herramientas cliente.
- Credenciales de una cuenta con permiso para crear/eliminar una base temporal y crear `pgcrypto`.
- Una copia cuyo checksum coincida con el registrado arriba.
- No apuntar a una base existente ni reutilizar nombres de producción.

Ejemplo PowerShell; el nombre debe ser temporal y explícito:

```powershell
$validationDb = 'ilvox_validation_20260722'
$sqlFile = 'C:\ruta\ilvox_complete_reconstructed.sql'

createdb --maintenance-db=postgres $validationDb
psql --dbname=$validationDb --set=ON_ERROR_STOP=1 --single-transaction --file=$sqlFile
psql --dbname=$validationDb --set=ON_ERROR_STOP=1 --command="select version();"
```

### Verificación de objetos

```sql
SELECT count(*) AS tables
FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relkind = 'r';

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

SELECT conrelid::regclass AS table_name, conname, contype,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, conname;

SELECT 'roles' AS entity, count(*) FROM roles
UNION ALL SELECT 'permissions', count(*) FROM permissions
UNION ALL SELECT 'role_permissions', count(*) FROM role_permissions;
```

Resultados esperados mínimos: 19 tablas de negocio, 11 roles, 23 permisos y 142 asociaciones. El total de índices de catálogo incluye los índices implícitos de PK/UNIQUE, por lo que no debe compararse ciegamente con 53; deben compararse nombres y definiciones.

### Pruebas positivas y negativas

Cada grupo debe ejecutarse dentro de una transacción que termina en `ROLLBACK`. Los casos negativos deben fallar con la constraint esperada y no abortar el resto del conjunto; conviene automatizarlos como pruebas independientes.

Cobertura requerida:

- estados de usuarios, organizaciones, membresías y webhooks;
- scopes de roles y membresías;
- origen, estado y consistencia de conversión de leads;
- categorías de servicios;
- fechas, estados y prioridades de proyectos;
- estados y timestamps de hitos/entregables;
- tipo, prioridades, estados, resolución y cierre de tickets;
- visibilidad y contenido de comentarios;
- contexto exclusivo, prioridad, estado y estimación de tareas;
- padre único, tamaño, checksum, clasificación y estado de archivos;
- JSON objeto en auditoría.

Ejemplo representativo:

```sql
BEGIN;

-- Positivo
INSERT INTO app_users (clerk_user_id, primary_email, status)
VALUES ('validation_user', 'validation@example.test', 'active');

SAVEPOINT before_negative;
-- Debe fallar con chk_app_users_status
INSERT INTO app_users (clerk_user_id, primary_email, status)
VALUES ('invalid_user', 'invalid@example.test', 'unknown');
ROLLBACK TO SAVEPOINT before_negative;

ROLLBACK;
```

En automatización, el caso negativo debe ejecutarse en una conexión/transacción aislada y se considera exitoso solo si falla por el nombre de constraint esperado.

### Prueba de rollback del script

Crear una segunda base temporal. Ejecutar una copia temporal del SQL con una sentencia inválida insertada antes de cada `COMMIT`, nunca modificar el original. Con `ON_ERROR_STOP=1`, verificar que el bloque correspondiente no dejó objetos/semillas parciales. El checksum del original debe permanecer idéntico.

### Limpieza

Solo después de comprobar el nombre exacto de la base temporal:

```powershell
dropdb --maintenance-db=postgres --if-exists --force $validationDb
```

No se creó ni eliminó ninguna base durante esta ejecución.

## Procedimiento ante un futuro cambio de versión

1. Aprobar la nueva versión y disponer de una base temporal aislada de esa versión.
2. Ejecutar `scripts/database-runtime-validate.mjs` contra esa conexión.
3. Confirmar que los resultados coinciden con PostgreSQL 18.4.
4. Conservar la evidencia y limpiar únicamente los recursos temporales creados.
