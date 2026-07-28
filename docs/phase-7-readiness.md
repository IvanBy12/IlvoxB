# Readiness para Fase 7 — Integración IlvoxF ↔ IlvoxB

Fecha de actualización: 27 de julio de 2026.

## Estado por bloque

| Bloque | Estado |
| --- | --- |
| Fase 7.0 — auditoría/plan | Completada |
| Fase 7.1 — fundaciones | Implementada y validada localmente |
| Fase 7.2+ — módulos funcionales | No iniciada |

Fase 7.1 implementó exclusivamente transporte HTTP, token Clerk, `/me`, cache,
errores, guards/gates, logout, cambio de usuario, origen/CORS y correcciones de
typecheck. La evidencia se encuentra en:

- `phase-7-foundations-implementation.md`;
- `phase-7-foundations-test-results.md`;
- `phase-7-authenticated-smoke.md`;
- `phase-7-integration-matrix.md`;
- `phase-7-implementation-plan.md`.

## Gate hacia el siguiente bloque

Typecheck, tests y builds pasan; el backend vivo respondió health 200/200,
rechazó `/me` sin token, cumplió CORS positivo/negativo/preflight para el origen
canónico y completó `/me` 200 con una sesión Clerk real y un perfil local activo
temporal.

El smoke autenticado verificó redirect, deep links, permisos, perfil inactivo,
backend no disponible, retry, logout, reautenticación y rutas ocultas. El
fixture PostgreSQL autorizado fue retirado por completo y el perfil quedó otra
vez en `pending`. No se inspeccionó ni persistió ningún token.

**Decisión:** Fase 7.1 está técnicamente cerrada y lista para que el propietario
decida si autoriza Fase 7.2. Esta conclusión no inicia ni autoriza
automáticamente el siguiente bloque. Permanece pendiente una revisión separada
de los advisories npm (1 moderado y 2 altos).

## Límites vigentes

Fase 7 no autoriza todavía archivos, tareas derivadas de tickets,
notificaciones, auditoría funcional, CRUD de usuarios/roles/permisos, SLA,
facturación, contactos empresariales independientes, invitaciones externas,
chat ni métricas empresariales definitivas. Esas capacidades permanecen
ocultas.

`AppStore` y el seed sobreviven solo como transición para módulos de negocio aún
no migrados. Ya no son autoridad de autenticación o permisos. No se inició
Fase 7.2 y este documento no la autoriza automáticamente.
