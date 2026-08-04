# Fase 7.5B — Resultados de pruebas

Fecha: 4 de agosto de 2026.

## Gates automáticos

| Gate | Resultado |
| --- | --- |
| Frontend `npm.cmd run check` | APROBADO: typecheck, 51/51 pruebas y build Vite. |
| Backend `npm.cmd run check` | APROBADO: typecheck, lint, 21 archivos/120 pruebas activas, 6 auditorías de constraints y build. |
| Smoke `npm.cmd run smoke:phase75b:internal` | APROBADO. |

El build frontend inicial quedó bloqueado por el sandbox al leer `vite.config.ts`; se
repitió con permiso acotado y pasó. No fue un error de código.

## Smoke HTTP/PostgreSQL

Prefijo: `PHASE75B_SMOKE_`.

Cobertura final:

- dos organizaciones y dos proyectos;
- listado paginado, detalle, edición y transición de proyecto;
- transición inválida `409` y conflicto de edición `409`;
- lectura cross-tenant `404`, escritura cross-tenant `403` y manage denegado `403`;
- miembros existentes, cambio de rol, revocación y miembro de otro proyecto `404`;
- hito create/detail/edit, proyecto incorrecto `404` y concurrencia `409`;
- entregable create/detail/approve, proyecto incorrecto y asociación con hito de otro
  proyecto `404`;
- tarea standalone, dos tareas de proyecto, edición en minutos, asignación a miembro
  conocido, transición por ese miembro, transición inválida, concurrencia, recurso
  inexistente, tarea de otro proyecto, standalone cliente denegada y creación con proyecto
  cross-tenant neutral;
- limpieza dentro de `finally`.

Una ejecución intermedia esperaba `403` al crear una tarea sobre un proyecto ajeno; el
backend respondió correctamente `404` scoped. La expectativa se ajustó y se añadió una
escritura de proyecto cross-tenant que cubre el `403` explícito. Esa ejecución fallida
también terminó con residuo cero.

Resultado final explícito:

```text
residualFixtures: 0
```

## Runtime

| Endpoint | Resultado |
| --- | --- |
| `/health/live` | 200 |
| `/health/ready` | 200 |
| `/me` sin token | 401 |
| `/api/v1/services` | 200 |

Los endpoints 7.5B autenticados se validaron mediante `app.inject` con identidades y
scopes PostgreSQL controlados por el smoke.

## Responsive y accesibilidad

Se inspeccionaron en navegador real `/app/proyectos`, `/app/tareas`, sus formularios y un
detalle completo con miembro, hito, entregable y tarea temporal.

| Ancho | Resultado |
| --- | --- |
| 360 px | Sin overflow de documento/main; tabla de tareas con scroll interno contenido. |
| 768 px | Sin overflow horizontal. |
| 1024 px | Sin overflow horizontal. |
| 1440 px | Sin overflow horizontal. |

La inspección encontró y corrigió fechas civiles desplazadas un día y wrapping de nombres
largos. El fixture visual `PHASE75B_SMOKE_VISUAL_` fue eliminado y la UI confirmó que ya
no aparecía.

- Cero inputs, textareas o comboboxes sin nombre accesible en las vistas inspeccionadas.
- Errores de formulario usan `role="alert"` y cargas usan estados anunciables.
- Controles activos muestran anillo de foco calculado de 3 px.
- Los controles del diálogo inspeccionado están en orden DOM y `tabIndex=0`.
- Confirmación de revocación presente; botones se deshabilitan durante mutaciones.

La automatización del navegador no desplazó el foco al enviar Tab, por lo que una pasada
manual completa de toda la secuencia de teclado queda **NO EJECUTADA**. Sí quedaron
validados nombres accesibles, tabulabilidad DOM y foco visible; no se declara una auditoría
WCAG exhaustiva.

## Regresiones

El gate frontend mantiene pruebas de login por invitación, `/me`, redirects, logout/cache,
signup/OAuth ausentes, portal cliente, catálogo público y leads. El backend mantiene sus
120 pruebas activas. No se ejecutó un correo invitado real ni un E2E remoto de Clerk en
esta fase; esas validaciones externas permanecen con el estado documentado en fases
anteriores.

## Operaciones estructurales

- Operaciones Git de escritura: 0.
- Migraciones o cambios estructurales: 0.
- Cambios RBAC/OpenAPI: 0.
- Fase 7.5C iniciada: no.

**Resultado: FASE 7.5B CERRADA TÉCNICAMENTE.**
