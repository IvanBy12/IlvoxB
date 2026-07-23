# Máquinas de estado de Fase 5

## Proyectos

Estados SQL: `planning`, `in_progress`, `paused`, `in_review`, `delivered`, `cancelled`.

| Desde | Hacia |
| --- | --- |
| `planning` | `in_progress`, `cancelled` |
| `in_progress` | `paused`, `in_review`, `cancelled` |
| `paused` | `in_progress`, `cancelled` |
| `in_review` | `in_progress`, `delivered`, `cancelled` |
| `delivered` | `in_progress` con administrador y motivo |
| `cancelled` | `planning` con administrador y motivo |

Cancelar exige motivo. Entregar exige todos los hitos `completed` y todos los entregables
`approved`. `delivered` y `cancelled` son terminales ordinarios. La transición usa lock de fila,
comparación del estado observado y auditoría.

## Tareas

Estados SQL: `pending`, `ready`, `in_progress`, `blocked`, `in_review`, `completed`,
`cancelled`.

| Desde | Hacia |
| --- | --- |
| `pending` | `ready`, `cancelled` |
| `ready` | `in_progress`, `cancelled` |
| `in_progress` | `blocked`, `in_review`, `cancelled` |
| `blocked` | `in_progress`, `cancelled` |
| `in_review` | `in_progress`, `completed`, `cancelled` |
| `completed` | `in_progress` con líder/admin y motivo |
| `cancelled` | `pending` con admin y motivo |

El flujo ordinario requiere assignee o líder. Completar/cancelar/reabrir exige líder o
administrador; reactivar una cancelada exige administrador. Las tareas de proyecto no cambian
si el proyecto está entregado o cancelado.

## Hitos y entregables

Se validan únicamente los estados físicos y las invariantes SQL:

- hito `completed` fija `completed_at`; cualquier otro estado lo limpia;
- entregable `approved` fija actor y `approved_at`; cualquier otro estado los limpia.

No se inventaron tablas de historial. Cada cambio queda en `audit_events`.
