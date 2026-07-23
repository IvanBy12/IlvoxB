# PostgreSQL 16 — resultado histórico de no evaluación

Fecha de actualización: 22 de julio de 2026.
Estado: **no ejecutado; compatibilidad desconocida; sin impacto bloqueante**.

## Resultado histórico

No hubo una instancia PostgreSQL 16 ni se ejecutaron baseline, migraciones, catálogo, pruebas o rollbacks en esa versión. Por tanto:

- no se afirma compatibilidad;
- no existe una versión 16.x validada;
- los conteos esperados nunca se presentarán como resultados PostgreSQL 16;
- no se requiere repetir el intento bajo la política actual.

La consulta local de limpieza realizada mediante `DATABASE_URL` fue de solo lectura y no constituyó evidencia PostgreSQL 16.

## Decisión que sustituye el intento

PostgreSQL 18.x es la familia soportada y PostgreSQL 18.4 es la versión validada oficialmente. En 18.4 aprobaron baseline, catálogo, migraciones `0001`–`0003`, restricciones, Drizzle, rollbacks y 44/44 pruebas con DB.

No se instalará PostgreSQL 16 ni se solicitará `TEST_DATABASE_URL` para cerrar este documento. Solo una nueva decisión de versión reabriría la validación completa descrita en `postgresql-version-policy.md`.
