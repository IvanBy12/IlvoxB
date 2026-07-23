# Auditoría runtime del webhook Clerk

Fecha: 22 de julio de 2026.  
Entorno: backend local y tenant Clerk **development** real.  
Resultado: **webhook real aprobado; matriz Clerk de Fase 3.5 cerrada posteriormente**.

## Preflight y backup

| Control | Resultado |
| --- | --- |
| Base/esquema | `GestionIlvox.public` |
| Motor | PostgreSQL 18.4 |
| Producción | No; base local de desarrollo |
| Hash baseline | `46D9EDDF29A0ABC25091E43867D0AC6B11A1AE180BDDF12665254BE9CD178CD6` |
| Estado baseline | 19 tablas, 199 columnas, 43 FK, 55 CHECK, 15 UNIQUE, 53 índices explícitos |
| RBAC baseline | 11 roles, 23 permisos, 142 asociaciones distintas |
| Migraciones parciales | Ninguna |
| Backup | Dump custom utilizable, 83.005 bytes, 172 entradas; listado y lectura completa aprobados |
| SHA-256 del backup | `832DCA0295686FF99B495BA587D9C2ED0CA939D64F023B96B4BBFFF38BDC1C47` |

El backup está fuera del repositorio, en el área temporal local. No se registraron credenciales en el archivo de auditoría.

## Migraciones y estado final

Las migraciones `0001`, `0002` y `0003` se ejecutaron por separado, en orden y con sus validaciones existentes. El estado final fue:

- 19 tablas, 204 columnas, 43 FK, 57 CHECK, 15 UNIQUE y 54 índices explícitos;
- 11 roles, 36 permisos y 157 asociaciones distintas;
- cero duplicados, cero referencias RBAC huérfanas y cero fugas de permisos sensibles;
- presentes `files.audience`, `payload_sha256`, `clerk_occurred_at`, `received_at`, `last_error_code` y los 13 permisos nuevos.

La consulta de `payload_sha256` que originó el incidente se ejecutó correctamente después de la migración.

## Observabilidad segura

El manejador registra internamente error original y stack, request ID, ID/tipo de evento, SQLSTATE y metadatos seguros de constraint, tabla, columna y esquema. Clasifica migración ausente, schema incorrecto, permisos, constraints, indisponibilidad, datos inválidos y colisión.

La respuesta pública de procesamiento fallido sigue siendo un `503` genérico. Payload, correos, tokens, firmas, headers completos, secretos y `DATABASE_URL` no se incorporan a los logs de aplicación.

## Pruebas y salud

- `npm.cmd run check`: typecheck, lint, build y 44 pruebas aprobadas; 9 integraciones DB omitidas en esa invocación.
- `npm.cmd run db:check`: aprobado.
- `npm.cmd run test:database -- --database-url`: 53/53 aprobadas.
- `npm.cmd run db:validate:phase3 -- --database-url`: migración y rollback temporal aprobados; cleanup y `publicUnchanged` verdaderos para esa validación aislada.
- `npm.cmd run db:check:phase3-cleanup`: cero esquemas temporales residuales.
- Auditorías SQL, RBAC y paridad: aprobadas.
- `GET /health/live`: 200.
- `GET /health/ready`: 200 con PostgreSQL disponible.

## Evidencia webhook real

| Caso | Entrega HTTP observada | Efecto local |
| --- | --- | --- |
| Reintento del `user.created` originalmente fallido | Succeeded (2xx) | Un evento `processed`; un usuario |
| Segundo reintento exacto | Succeeded (2xx) | Sin segunda fila ni segundo efecto; `attempt_count` lógico permanece en 1 |
| `user.created` temporal | Succeeded (2xx) | Usuario local `pending`, sincronizado |
| `user.updated` temporal | Succeeded (2xx) | Nombre actualizado; misma fila de usuario |
| `user.deleted` temporal | Succeeded (2xx) | Tombstone local `deleted` |
| Reintento de `user.deleted` | Succeeded (2xx) | Sin duplicados; continúa `deleted` |
| `user.updated` antiguo después de delete | Succeeded (2xx) | Evento reconocido sin resurrección; continúa `deleted` |

Conteo final de esta auditoría: cuatro eventos únicos `processed` (`user.created` ×2, `user.updated` ×1, `user.deleted` ×1), `max(attempt_count)=1`, dos usuarios locales y un tombstone. El usuario temporal fue eliminado de Clerk y el archivo temporal que conservaba su identificador fue destruido.

## Alcance y resultado

La parte de webhook real de Clerk quedó aprobada para el tenant development observado. Esta ejecución no probó autenticación real, `/me`, aislamiento A/B ni policies de archivos con identidades reales; esos casos fueron ejecutados y documentados posteriormente en `clerk-staging-test-results.md`.

Durante una comprobación posterior de configuración, una orden local imprimió accidentalmente el valor del secreto de firma del webhook en la salida de herramienta. No fue escrito en el repositorio ni en estos documentos. El secreto fue rotado y la nueva referencia aprobó después un smoke corto real `user.created`/`user.deleted`, con limpieza completa; la auditoría exhaustiva de este documento no se repitió.
