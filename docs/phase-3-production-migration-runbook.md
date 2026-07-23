# Runbook de migración de producción — Fase 3

Estado: **preparado, no autorizado para ejecución**.
Este documento no autoriza aplicar cambios. La ejecución requiere una ventana separada, aprobaciones humanas, PostgreSQL 18.x y conservar vigente la validación Clerk cerrada el 23 de julio de 2026. `drizzle-kit push` está prohibido.

## 1. Responsables y registro de cambio

Antes de abrir la ventana, registrar: ticket de cambio, entorno y base exactos, responsable backend, DBA ejecutor, aprobador de seguridad/producto, versión/commit de aplicación, hora de inicio, canal de incidente y decisor de rollback. No registrar URLs completas, contraseñas, tokens ni secretos Clerk.

## 2. Precondiciones obligatorias

- Backup completo terminado y restauración ensayada en un entorno aislado.
- Destino confirmado dentro de PostgreSQL 18.x; PostgreSQL 18.4 es la versión runtime validada oficialmente.
- Si el proveedor ofrece una versión fuera de 18.x, detenerse y completar antes la validación específica definida en `postgresql-version-policy.md`.
- Baseline con SHA-256 `46D9EDDF29A0ABC25091E43867D0AC6B11A1AE180BDDF12665254BE9CD178CD6`.
- Catálogo principal demostrado equivalente a la baseline pre-Fase 3: 19 tablas, 199 columnas, 43 FK, 55 CHECK, 15 UNIQUE y 53 índices explícitos.
- Aplicación compatible construida, probada y lista para despliegue coordinado.
- Variables Clerk del entorno configuradas mediante secret manager; authorized parties exactas; modelo `Membership optional / Personal Accounts`; webhook firmado configurado y probado en staging.
- Ventana/mensaje de mantenimiento aprobados; escrituras que compitan con RBAC, archivos o identidad detenidas.
- Plan de rollback aprobado y responsable con autoridad para activarlo.
- Ningún gate pendiente, alerta de backup, drift o incidente activo.

Si cualquier precondición falla: **detenerse; no ejecutar migraciones**.

## 3. Preflight de solo lectura

Ejecutar con una identidad DB de cambio controlada y `ON_ERROR_STOP=1`. Confirmar manualmente host, puerto, base y `server_version`; rechazar un destino ambiguo o cuya major no sea 18. Una versión distinta exige detener la ventana y completar primero una validación específica aprobada.

```sql
SELECT current_setting('server_version') AS version,
       current_database() AS database,
       inet_server_addr() AS host,
       inet_server_port() AS port;

SELECT count(*) AS roles FROM roles;
SELECT count(*) AS permissions FROM permissions;
SELECT count(*) AS associations FROM role_permissions;
SELECT count(*) AS distinct_associations
FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d;

SELECT count(*) AS active_super_admins
FROM app_users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id
WHERE u.status = 'active' AND r.scope = 'global' AND r.code = 'super_admin';
```

Registrar además, con consultas de catálogo aprobadas:

- 19/199/43/55/15/53 y nombres esperados de constraints/índices;
- cero duplicados y cero referencias RBAC inexistentes;
- estado exacto de `_drizzle_migrations`/reconocimiento de baseline;
- extensión `pgcrypto` presente;
- espacio libre, tamaño de tablas/índices y estado del backup;
- conexiones y transacciones activas, locks y sesiones `idle in transaction`;
- health/readiness iniciales y tasa de error estable;
- duración medida en staging. Es una estimación operativa, no una promesa.

Ejecutar desde el artefacto exacto que se desplegará:

```powershell
Get-FileHash -Algorithm SHA256 drizzle\baseline\0000_ilvox_complete_reconstructed.sql
npm.cmd run db:check
npm.cmd run audit:sql -- drizzle\baseline\0000_ilvox_complete_reconstructed.sql
npm.cmd run audit:rbac -- drizzle\baseline\0000_ilvox_complete_reconstructed.sql
npm.cmd run audit:parity -- drizzle\baseline\0000_ilvox_complete_reconstructed.sql
```

No ejecutar la baseline sobre una base que ya contiene las tablas. La baseline se reconoce únicamente siguiendo `database-parity.md` después de demostrar equivalencia exacta.

## 4. Aplicación

Crear primero un registro operativo de los conteos preflight. Ejecutar una migración por vez, en este orden, usando la URL obtenida del secret manager sin imprimirla:

```powershell
psql --dbname=$env:PRODUCTION_DATABASE_URL --set=ON_ERROR_STOP=1 --single-transaction --file=drizzle\migrations\0001_phase3-rbac-separation.sql
psql --dbname=$env:PRODUCTION_DATABASE_URL --set=ON_ERROR_STOP=1 --single-transaction --file=drizzle\migrations\0002_phase3-file-audience.sql
psql --dbname=$env:PRODUCTION_DATABASE_URL --set=ON_ERROR_STOP=1 --single-transaction --file=drizzle\migrations\0003_phase3-clerk-event-idempotency.sql
```

La variable anterior es solo un marcador operativo; no se versiona ni se imprime. No usar `drizzle-kit push`.

### Después de `0001`

- 11 roles, 36 permisos y 157 asociaciones totales/distintas;
- 13 permisos nuevos, 11 grants retirados y 26 agregados;
- cero duplicados y referencias inexistentes;
- `permissions.manage`, `roles.assign_super_admin`, `security.manage`, `system.configure` y `organizations.access_all` solo en `global:super_admin`;
- al menos un superadmin activo conserva acceso.

### Después de `0002`

- `files.audience` existe, `NOT NULL`, default `internal`;
- valores existentes migrados a `internal` y solo `internal|organization` aceptados;
- `chk_files_single_parent` usa máximo un padre;
- existe `idx_files_organization_audience_active` y no apareció un índice redundante;
- conteos acumulados: 203 columnas, 56 CHECK y 54 índices explícitos.

### Después de `0003`

- existen `clerk_occurred_at`, `received_at`, `payload_sha256`, `last_error_code`;
- todos los registros preexistentes tienen timestamp/hash válidos;
- UNIQUE histórico de `clerk_event_id`, estados, intentos y fechas permanecen íntegros;
- catálogo final: 19 tablas, 204 columnas, 43 FK, 57 CHECK, 15 UNIQUE y 54 índices explícitos.

Detenerse inmediatamente ante precondición RBAC fallida, lock timeout, deadlock, drift, SQLSTATE inesperado, conteo distinto, pérdida de superadmin, error de health/readiness o incapacidad de verificar una etapa. No continuar para “compensar” resultados.

## 5. Despliegue y postvalidación

Desplegar la versión compatible según el plan coordinado y comprobar:

- health y readiness;
- autenticación válida/inválida sin filtrar errores externos;
- `/me` de usuario interno y cliente sin tokens, metadata o organizaciones ajenas;
- autorización y aislamiento A/B, incluido UUID real ajeno;
- webhooks firmados `created/updated/deleted`, duplicado y evento antiguo;
- cero roles/permisos/membresías derivados de metadata Clerk;
- archivos `internal`/`organization`, cross-org y cuarentena;
- 36 permisos, 157 asociaciones, cero fugas sensibles;
- cola/reintentos webhook, códigos seguros y logs redactados;
- errores, latencia y conexiones dentro de los umbrales aprobados.

Mantener la ventana abierta hasta completar la observación acordada. No crear automáticamente usuarios privilegiados para reparar acceso.

## 6. Rollback

El rollback es seguro únicamente si se evalúan los datos creados después de cada migración. Detener escrituras y conservar evidencia antes de revertir.

1. `0003` inversa: exportar/archivar de forma segura IDs, estados y códigos operativos necesarios; no guardar payloads sensibles. Revertir elimina columnas de hash/timestamps/error y reduce protección de idempotencia. Deshabilitar recepción webhook durante la transición.
2. `0002` inversa: verificar que no existan archivos directos (cero padres), pues el rollback aborta en ese caso. Resolver/retirar esos datos con aprobación. Registrar qué audiencias se perderán al eliminar la columna.
3. `0001` inversa: confirmar estado exacto 36/157 y revisar operaciones que dependan de permisos nuevos. El rollback restaura 23/142; validar que la versión de aplicación anterior esté lista.

Ejecutar en orden inverso; los archivos down ya contienen transacción y guardas:

```powershell
psql --dbname=$env:PRODUCTION_DATABASE_URL --set=ON_ERROR_STOP=1 --file=drizzle\rollbacks\0003_phase3-clerk-event-idempotency.down.sql
psql --dbname=$env:PRODUCTION_DATABASE_URL --set=ON_ERROR_STOP=1 --file=drizzle\rollbacks\0002_phase3-file-audience.down.sql
psql --dbname=$env:PRODUCTION_DATABASE_URL --set=ON_ERROR_STOP=1 --file=drizzle\rollbacks\0001_phase3-rbac-separation.down.sql
```

Tras rollback exigir 19 tablas, 199 columnas, 43 FK, 55 CHECK, 15 UNIQUE, 53 índices explícitos, 11 roles, 23 permisos y 142 asociaciones distintas. Restaurar la versión anterior de la aplicación, health/readiness, autenticación y acceso de superadmin. Si el rollback lógico no puede preservar datos, activar el plan de restauración del backup, no improvisar DDL.

## 7. Cierre

Adjuntar comandos, horas, conteos, SQLSTATE, aprobaciones y resultados sanitizados al ticket de cambio. Confirmar que no quedaron locks, sesiones de mantenimiento, datos de prueba, cuentas temporales ni secretos en logs. La aprobación final debe ser explícita; el simple fin de los comandos no constituye éxito.
