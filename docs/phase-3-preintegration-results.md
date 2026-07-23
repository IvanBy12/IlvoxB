# Resultados de preintegración — Fase 3.5

Fecha: 23 de julio de 2026.  
Resultado global: **Fase 3.5 aprobada; preparada para iniciar Fase 4 cuando se autorice**.

## Gates cerrados

| Área | Estado |
| --- | --- |
| Baseline y migraciones `0001`–`0003` | Aprobadas previamente |
| PostgreSQL oficial | 18.x |
| PostgreSQL runtime validado | 18.4 |
| PostgreSQL 16 | No evaluado, no soportado y no bloqueante |
| Webhook Clerk real | Aprobado |
| Signing Secret rotado | Aprobado mediante smoke corto |
| Autenticación Clerk real | Aprobada |
| `GET /me` real | Aprobado |
| Aislamiento A/B | Aprobado |
| Archivos con identidad real | Aprobado para lectura/carga directa y cuarentena |
| Escalación vertical | Aprobada |
| Limpieza | Aprobada |

## Evidencia Clerk

La instancia Development usada para integración quedó en `Membership optional / Personal Accounts`. Esto permite sesiones personales sin crear organizaciones Clerk y conserva PostgreSQL como autoridad única para organizaciones, membresías y RBAC.

Se utilizó un solo usuario externo temporal y se reutilizó el mismo `clerk_user_id` sobre perfiles locales controlados. El session token nunca se imprimió ni se escribió en archivos. El usuario externo y todos los fixtures locales fueron eliminados al terminar.

## Límites

- No se modificó el frontend.
- No se implementó Fase 4.
- No se aplicaron migraciones, `drizzle-kit push`, commit ni push.
- No se repitieron las pruebas PostgreSQL 18.4 ya aprobadas.
- Los endpoints de archivos/privilegios fueron harnesses temporales fuera de `src`.

## Decisión

No quedan gates externos de Fase 3.5. El proyecto puede comenzar Fase 4 cuando exista autorización explícita. La implementación futura de listados de archivos debe aplicar status/policy además del scope SQL para excluir cuarentena y estados no activos.
