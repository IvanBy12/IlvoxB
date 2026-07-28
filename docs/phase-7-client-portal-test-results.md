# Fase 7.4 — Resultados de pruebas del portal

Fecha: 28 de julio de 2026.

## Estado Git

| Repositorio | Rama | HEAD inicial/final |
| --- | --- | --- |
| IlvoxF | `dev` | `cff4fec7c6bb8e5fd4622a42993994c15e515d5e` |
| IlvoxB | `main` | `c6a90aab816014b486e6ee234f2ac12ee1e0506d` |

Los HEAD no cambiaron. No se hizo stage, commit, push, pull, reset, merge o
rebase. Los worktrees ya contenían cambios de Fases 7.1–7.3 y se preservaron.

## Frontend

| Comando | Resultado |
| --- | --- |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd test` | PASS, 29/29 |
| `npm.cmd run build` | PASS |
| `npm.cmd run check` | PASS; repite typecheck, 29/29 y build |

Cobertura 7.4:

- organización 0/1/múltiples y cambio de contexto;
- limpieza de cache portal sin borrar identidad;
- proyecto/ticket autorizado y fuera de scope;
- standalone/organización/proyecto;
- payload de creación sin requester, assignee o prioridad operativa;
- comentario cliente explícito e interno fail closed;
- identidad dual sin GET de conversación desde portal;
- permiso+estado para confirmar, rechazar y reabrir;
- `expectedUpdatedAt`, motivos, 401/403/404/409;
- mutaciones sin retry y bloqueos de doble submit;
- sin `AppStore`, seed, almacenamiento de scope, HTML inseguro o filtro local de
  tenant;
- rutas fuera de alcance ausentes y ARIA/breakpoints presentes.

Vite emitió una advertencia no bloqueante de chunk mayor a 500 kB. No se
ejecutó `npm audit fix`.

## Backend

| Comando | Resultado |
| --- | --- |
| `npm.cmd run check` | PASS |
| Typecheck | PASS |
| ESLint | PASS |
| Vitest | PASS, 111 ejecutadas; 47 DB omitidas por falta de `TEST_DATABASE_URL` |
| Auditoría de constraints | PASS, 6/6 |
| Build | PASS |
| Pruebas focalizadas scopes/HTTP | PASS, 12/12 |

Las pruebas DB omitidas por el runner general no sustituyen el smoke 7.4: este
sí usó la `DATABASE_URL` configurada y ejerció HTTP contra PostgreSQL real.

## Smoke PostgreSQL

Comando: `npm.cmd run smoke:phase74:portal`.

Resultado final:

```json
{
  "ok": true,
  "markerPrefix": "PHASE74_SMOKE_",
  "organizations": 2,
  "organizationIsolation": true,
  "projects": true,
  "milestones": true,
  "deliverables": true,
  "tickets": ["standalone", "organization", "project"],
  "comments": {
    "clientVisible": true,
    "internalHidden": true
  },
  "resolution": {
    "confirm": true,
    "reject": true,
    "reopen": true,
    "conflict": true
  },
  "residualFixtures": 0
}
```

La primera ejecución diagnóstica encontró el nombre de tabla incorrecto en el
script nuevo; una utilidad temporal retiró 3 usuarios, 2 organizaciones y 2
proyectos antes de repetir. La segunda brecha fue funcional: proyectos vacíos
por scope `own`. La siguiente ejecución reveló lectura interna para un cliente
con rol de proyecto. Ambos defectos de autorización fueron corregidos y el
smoke final pasó con residuo cero.

## Runtime

| Operación | Estado |
| --- | --- |
| `GET /health/live` | 200 |
| `GET /health/ready` | 200 |
| `GET /me` sin token | 401 |
| `GET /api/v1/services` | 200 |

## Responsive y accesibilidad

Se inspeccionó el guard/login real en navegador integrado a 360, 768, 1024 y
1440 px. A 360 px se detectó overflow por el ancho intrínseco de Clerk; se
añadió `min-w-0` al `AuthShell` y la repetición terminó sin overflow en los
cuatro tamaños, con inputs etiquetados y controles focusables.

Las vistas conectadas del portal tienen pruebas estáticas de `sm`, `md`, `lg`,
landmarks, `aria-label`, `aria-expanded`, `aria-invalid`, `role=alert/status`,
labels y texto plano. No se ejecutó el recorrido visual autenticado de esas
vistas porque el navegador de prueba no tenía una sesión Clerk y no se
solicitaron ni almacenaron credenciales. Esta es la única condición pendiente
para aprobación visual final; no afecta los contratos, smoke HTTP o aislamiento.

## Regresiones 7.1–7.3

- login continúa cerrado por invitación;
- no hay signup público, OAuth o Clerk Organizations;
- `/me` permanece protegido;
- `/servicios` responde y los contratos públicos conservan sus pruebas;
- formularios públicos conservan validación, fuentes y POST sin retry;
- logout/cambio de usuario limpian cache;
- funciones ocultas continúan sin rutas de portal.

## Decisión

**Fase 7.4 aprobada con una condición operativa:** ejecutar un recorrido visual
autenticado de `/portal`, proyectos y tickets en 360/768/1024/1440 cuando haya
una sesión Clerk de cliente disponible. El código, contratos, aislamiento,
PostgreSQL, runtime y gates automatizados están aprobados.

No se inició Fase 7.5.
