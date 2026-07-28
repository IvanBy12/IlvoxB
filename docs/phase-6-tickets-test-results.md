# Resultados de pruebas de tickets de Fase 6

## Validación local

- TypeScript: aprobado.
- ESLint: aprobado.
- Build: aprobado.
- Vitest local: 99 aprobadas, 47 PostgreSQL omitidas sin URL de test.
- Auditor de constraints: 6 aprobadas.
- `drizzle-kit check`: aprobado.
- Paridad estática: aprobada con artefactos 0008 pendientes en `public`.
- OpenAPI: 0.6.0, 55 operaciones.

## PostgreSQL 18.4

- Suite completa: 146/146 pruebas en 23 archivos.
- Ensayo 0008: aprobado mediante migrador oficial en schemas aislados.
- Segundo migrate: no-op confirmado.
- Catálogo migrado: 19 tablas, 208 columnas, 47 FK, 60 CHECK, 16 UNIQUE y
  58 índices explícitos.
- RBAC migrado: 11 roles, 39 permisos y 165 asociaciones.
- Rollback 0008: guardado ante datos standalone y aprobado después de retirar
  fixtures; restauró 19/208/45/59/16/56.
- Integridad de código generado, proyecto/tenant y comentario/ticket: aprobada.
- Concurrencia, scopes, revocación y auditoría: aprobadas.
- Validadores de runtime, Fase 3, Fase 4.5 y cierre Fase 5: aprobados.
- `GestionIlvox.public`: sin cambios; historia exacta 0000-0007 y 0008
  pendiente.
- Schemas y fixtures temporales: eliminados; residuales cero.

## Cobertura añadida

Se cubren contratos HTTP cerrados, identidad server-owned, scope propio,
filtros, campos protegidos, asignación, prioridad, transiciones, comentarios,
máquina de estados y corrección `milestoneId`.

La suite PostgreSQL de Fase 6 cubre contextos standalone/organización/proyecto,
aislamiento own, revocación, FKs/checks, trigger de comentarios, auditoría
redactada, locks, concurrencia de asignación/transición y generación de códigos.

## Auditoría npm

`npm audit --omit=dev` y `npm audit` no pudieron acceder al endpoint. El
resultado permanece inconcluso; no se afirma cero vulnerabilidades y no se
ejecutó `audit fix --force`.
