# Despliegue operativo del cierre de Fase 5

Fecha: 24 de julio de 2026.

## Alcance y resultado

La operacion se ejecuto unicamente sobre el backend ILVOX y la base local de
desarrollo `GestionIlvox.public`, PostgreSQL 18.4. No se inicio Fase 6, no se
modifico frontend y no hubo stage, commit, push ni publicacion.

Resultado final: historia Drizzle 0000-0007 exacta, migraciones 0006-0007
aplicadas mediante el migrador oficial y smokes reales aprobados.

## Respaldo del codigo

- Archivo: `IlvoxB-code-final-pre-public-20260724-141613.zip`.
- Ubicacion: fuera del repositorio, en el directorio local de evidencias de
  Codex `ilvox-phase5-operational-backups`.
- Formato: ZIP.
- Fecha local: `2026-07-24T14:16:13.5849181-05:00`.
- Tamano: 463.680 bytes.
- SHA-256:
  `DCE57090B04A19123FA03BAD56DBA7D44FB46CDD4FCE28A1AC56616867B16173`.
- Contenido: 267 entradas y 227 archivos.
- Verificacion: extraccion completa, SHA-256 archivo por archivo y cero
  diferencias.
- Incluye 0006, 0007, ambos rollbacks, snapshots, codigo, pruebas,
  documentacion, configuracion y el script operacional.

Se excluyeron `.git`, `node_modules`, `.env`, logs, temporales y backups
anteriores. No se mostraron secretos.

## Backup PostgreSQL

- Archivo: `GestionIlvox-pre-phase5-operational-20260724190922.dump`.
- Formato: PostgreSQL custom archive.
- Herramientas: `pg_dump`/`pg_restore` 18.4.
- Tamano: 87.537 bytes.
- Entradas: 173.
- SHA-256:
  `FBE6BADE8F87759E9462A65E4F9F29EC954F29457864916C5BF589049B994501`.
- Verificacion: `pg_restore --list` aprobo y una lectura/descompresion completa
  a `NUL` aprobo.

El inventario verifico schema, datos, RBAC, proyectos, miembros, hitos,
entregables, tareas, constraints e indices.

## Preflight

- Base/schema/usuario: `GestionIlvox` / `public` / `postgres`.
- Host/puerto: `127.0.0.1` / `5432`.
- Version: PostgreSQL 18.4.
- `search_path`: `"$user", public`.
- Entorno: development; servidor fuera de recovery.
- Historia inicial: ausente.
- Estado fisico inicial: 19/204/43/57/15/54 y RBAC 11/37/159.
- Efectos 0001-0005: todos presentes.
- Efectos 0006-0007: ausentes.
- Locks no concedidos, transacciones abandonadas, drift y schemas temporales:
  cero.

## Ensayo temporal

En la base temporal `ilvox_phase5_rehearsal_55e844d8fc1a` se reprodujo el
estado fisico 0005 sin historia. Se reconocieron 0000-0005 en una transaccion y
el migrador oficial detecto y aplico solo 0006-0007. El catalogo quedo
19/208/45/59/16/56, el segundo migrate fue no-op y los rollbacks controlados
0007/0006 restauraron 19/204/43/57/15/54. La base temporal fue eliminada.

Durante el primer ensayo se detectaron limites `BEGIN`/`COMMIT` redundantes en
0006-0007. Se retiraron antes del despliegue porque la transaccion pertenece al
migrador oficial; los hashes documentados son los definitivos posteriores a
esa correccion.

## Operacion en public

El comando `db:operate:phase5` repitio el preflight dentro de una transaccion,
obtuvo advisory lock y creo la historia con la forma exacta del migrador.
Registro seis filas exactas 0000-0005, sin duplicados y sin 0006-0007. La
inspeccion inmediata confirmo que solo 0006 y 0007 estaban pendientes.

El migrador oficial Drizzle, protegido por advisory lock de sesion, aplico en
orden 0006 y 0007. Un segundo migrate no produjo cambios. No se ejecuto DDL
historico de 0000-0005, `drizzle-kit push`, DDL manual equivalente ni rollbacks
en `public`.

## Postflight

| Metrica | Resultado |
| --- | ---: |
| Tablas | 19 |
| Columnas | 208 |
| Foreign keys | 45 |
| CHECK | 59 |
| UNIQUE | 16 |
| Indices explicitos | 56 |
| Roles | 11 |
| Permisos | 37 |
| Asociaciones RBAC distintas | 159 |

`project_members` contiene estado y metadatos de revocacion, checks, FK al
actor e indice activo. `deliverables` contiene `milestone_id`, soporte UNIQUE,
FK compuesta de tenant/proyecto e indice; la FK usa `ON DELETE RESTRICT` y
`ON UPDATE NO ACTION`. Todas las nuevas constraints estan validadas. No existen
constraints ni indices duplicados, drift o cambios RBAC.

## Runtime, smokes y regresiones

- `/health/live`: 200, estado `ok`.
- `/health/ready`: 200, estado `ready`.
- Pool activo y sin errores de schema o warnings criticos.
- OpenAPI 0.5.1, 44 operaciones.
- Revocacion real: aprobada, idempotente, un evento de auditoria y acceso
  retirado inmediatamente.
- Entregable-hito: aprobada; cruce HTTP rechazado y SQLSTATE `23503`.
- Concurrencia: `[200, 409]`; proyecto cerrado: `409`.
- Pruebas locales: 87.
- Pruebas PostgreSQL: 126/126 en 20 archivos.
- `check`, `db:check`, auditores SQL/RBAC/paridad/nombres y validadores de
  baseline/Fase 3/Fase 4.5/Fase 5: aprobados.

## Limpieza y riesgo restante

No quedaron fixtures de smoke, schemas temporales, usuarios Clerk ni sesiones
Clerk. La historia y las migraciones aplicadas se conservaron.

`npm audit --omit=dev` y `npm audit` no pudieron consultar el endpoint de
advisories; el resultado es inconcluso. No se afirma cero vulnerabilidades, no
se ejecuto `audit fix --force` y este control sigue siendo gate de despliegue
publico.

Durante una comprobacion read-only posterior, una invocacion fallida de `psql`
incluyo accidentalmente el DSN local en la salida diagnostica de la tarea. No
se copio a archivos ni se envio a un servicio externo, pero la credencial de
desarrollo debe rotarse por precaucion. El valor no se reproduce en esta
documentacion.
