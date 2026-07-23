# PostgreSQL 16 — compatibilidad no evaluada (historial)

Fecha de actualización: 22 de julio de 2026.
Estado: **no probado, no soportado oficialmente y no bloqueante**.

Este documento conserva el historial de la decisión anterior que trataba PostgreSQL 16 como versión objetivo. Esa decisión fue sustituida por `postgresql-version-policy.md`:

- PostgreSQL 18.x es la familia oficial.
- PostgreSQL 18.4 es la versión validada.
- PostgreSQL 16 no fue ejecutado ni validado.
- No se afirma compatibilidad con PostgreSQL 16.
- Su ausencia no bloquea Fase 3.5, Fase 4 ni producción dentro de PostgreSQL 18.x.
- No se debe instalar PostgreSQL 16 ni solicitar `TEST_DATABASE_URL` para esa versión bajo la política vigente.

El hash de la baseline observado durante el intento histórico fue:

`46D9EDDF29A0ABC25091E43867D0AC6B11A1AE180BDDF12665254BE9CD178CD6`

Si una decisión futura selecciona PostgreSQL 16 o cualquier versión fuera de 18.x, deberá abrirse una validación nueva y específica: baseline, catálogo, tres migraciones, suite DB, rollbacks, comparación con 18.4 y limpieza. Hasta entonces PostgreSQL 16 permanece simplemente como compatibilidad desconocida.
