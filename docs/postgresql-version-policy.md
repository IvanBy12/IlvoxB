# Política oficial de versiones PostgreSQL

Fecha de decisión: 22 de julio de 2026.
Estado: **vigente**.

## Decisión

- La familia oficialmente soportada por ILVOX es **PostgreSQL 18.x**.
- La versión con evidencia runtime completa es **PostgreSQL 18.4**.
- Staging y producción deben permanecer en PostgreSQL 18.x salvo una nueva decisión arquitectónica explícita.
- PostgreSQL 16 no fue probado, no está oficialmente soportado y se conserva únicamente como compatibilidad no evaluada.
- La ausencia de PostgreSQL 16 no es un riesgo bloqueante ni un gate de Fase 3.5, Fase 4 o producción.
- No se debe instalar, aprovisionar ni solicitar `TEST_DATABASE_URL` con el propósito de validar PostgreSQL 16 bajo la decisión vigente.

## Evidencia oficial

PostgreSQL 18.4 ejecutó satisfactoriamente la baseline exacta, catálogo, restricciones, claves, identity, columna generada, índices, Drizzle, migraciones `0001`–`0003`, rollbacks y la suite de Fase 3. Esta evidencia es el runtime oficial del proyecto; no debe repetirse sin una causa nueva.

## Cambio de versión

Si staging o producción fueran a utilizar otra versión —incluida otra major, una versión ofrecida por un proveedor o PostgreSQL 16— se requiere antes del despliegue:

1. nueva decisión arquitectónica y versión concreta aprobada;
2. instancia temporal aislada de esa versión;
3. checksum y aplicación de la baseline exacta;
4. validación completa de catálogo, constraints, identity, generated e índices;
5. aplicación individual y conjunta de `0001`, `0002` y `0003`;
6. rollbacks inversos y estado restaurado;
7. suite DB/Fase 3, concurrencia, advisory locks e idempotencia;
8. comparación documentada contra PostgreSQL 18.4;
9. limpieza de recursos temporales y aprobación humana.

No se infiere compatibilidad entre majors a partir de sintaxis estática. Una versión diferente no puede promoverse hasta completar esta validación específica.

## Historial

La decisión anterior consideraba PostgreSQL 16 como versión objetivo. Fue sustituida antes de concluir Fase 3.5 al adoptar PostgreSQL 18.x y reconocer PostgreSQL 18.4 como evidencia oficial. Los documentos específicos de PostgreSQL 16 se conservan como registro histórico y declaran explícitamente que esa compatibilidad no fue evaluada.
