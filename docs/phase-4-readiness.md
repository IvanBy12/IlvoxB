# Readiness para Fase 4

Fecha: 23 de julio de 2026.  
Decisión histórica: la Fase 4 fue autorizada e iniciada el 23 de julio de 2026.

## Gates

| Gate | Estado |
| --- | --- |
| Implementación Fase 3 y pruebas locales | Aprobado |
| Integridad baseline/Drizzle | Aprobado |
| PostgreSQL 18.x oficial | Aprobado |
| PostgreSQL 18.4 runtime | Aprobado |
| PostgreSQL 16 | No evaluado, no soportado y no bloqueante |
| Webhook Clerk real | Aprobado |
| Signing Secret rotado | Aprobado con smoke corto |
| Sesión Clerk real | Aprobada; active y sin tareas pendientes |
| `/me` real | Aprobado |
| Aislamiento A/B y membresía revocada | Aprobado |
| Archivos con identidad real | Aprobado, con condición de filtrado para futuros listados |
| Escalación vertical y auditoría | Aprobado |
| Limpieza externa/local | Aprobada |
| Gate externo pendiente | Ninguno |

## Política de despliegue

- PostgreSQL de staging y producción debe permanecer en 18.x.
- Una versión distinta requiere validación específica completa antes del despliegue.
- Clerk debe conservar el modelo acordado: sesión personal externa y autorización organizacional local en PostgreSQL.
- Cada entorno debe configurar authorized parties exactas y conectividad para verificación Clerk.

## Condiciones aplicadas durante Fase 4

- autorización explícita del propietario del proyecto, recibida;
- aplicar status/policy en los listados de archivos, además del scope de repositorio;
- mantener archivos privados y emitir únicamente URLs temporales cuando esa capacidad se implemente;
- completar observabilidad/dead-letter del webhook y controles operativos del almacenamiento.

La ejecución y sus gates de salida se documentan en `phase-4-implementation.md` y
`phase-5-readiness.md`. No se modificó el frontend, no se aplicaron migraciones y no se
ejecutó `drizzle-kit push`, commit o push.
