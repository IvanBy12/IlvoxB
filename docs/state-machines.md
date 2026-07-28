# Máquinas de estado propuestas

Fecha: 2026-07-22  
Fuentes: restricciones `CHECK` del SQL, tipos/enums y acciones del frontend `IlvoxF`.  
Estado: diseño de backend; no se modificó el SQL ni el frontend.

## Principio general

Las restricciones SQL validan valores y algunas invariantes de timestamps, pero no validan el estado anterior. Por ello, “Permitido por SQL” significa que el estado final puede persistirse si se satisfacen los demás `CHECK`; no significa que el salto deba permitirse en negocio. El backend debe bloquear transiciones no enumeradas, usar control optimista y registrar auditoría.

## Lead

### Estados

SQL y frontend representan la misma tubería con códigos traducidos:

`new`, `contacted`, `in_diagnostic`, `quotation`, `proposal_sent`, `negotiation`, `approved`, `not_approved`, `converted`.

La máquina simplificada sugerida (`new`, `contacted`, `qualified`, `converted`, `lost`) no debe reemplazar la actual: `qualified` y `lost` no existen en SQL, mientras el SQL conserva etapas comerciales útiles. Conceptualmente, `approved` equivale a una oportunidad calificada/ganada y `not_approved` a perdida.

| Estado inicial | Acción | Estado final | Actor permitido | Permitido por SQL | Requiere migración |
| --- | --- | --- | --- | --- | --- |
| `new` | registrar primer contacto | `contacted` | comercial/admin | Sí | No |
| `contacted` | iniciar diagnóstico | `in_diagnostic` | comercial/admin | Sí | No |
| `in_diagnostic` | preparar cotización | `quotation` | comercial/admin | Sí | No |
| `quotation` | enviar propuesta | `proposal_sent` | comercial/admin | Sí | No |
| `proposal_sent` | iniciar negociación | `negotiation` | comercial/admin | Sí | No |
| `negotiation` | aprobar oportunidad | `approved` | comercial/admin | Sí | No |
| `negotiation` | marcar no aprobada | `not_approved` | comercial/admin | Sí | No |
| cualquier no terminal | cerrar como no aprobada con motivo | `not_approved` | comercial/admin | Sí | Actividad/motivo futuro |
| `not_approved` | reactivar con motivo | `contacted` | comercial/admin | Sí | Actividad/motivo futuro |
| `approved` | convertir transaccionalmente | `converted` | `leads.manage` + `organizations.manage` | Sí, exige organización y fecha | No para transición; sí para actividad MVP |
| `converted` | cualquier transición | cualquiera | ninguno | El SQL podría aceptarla si se limpian campos | Bloqueada por negocio |

Reglas adicionales:

- `converted` es terminal y conserva `converted_organization_id` y `converted_at`.
- La conversión solo se permite desde `approved`, aunque el `CHECK` no impone el estado anterior.
- La UI Kanban permite arrastrar entre casi todas las columnas sin validar ruta. La vista de lista ofrece “Convertir” para cualquier lead no convertido, y el store no exige `approved`; el backend debe rechazarlo.
- Cambiar a `not_approved` o reactivar debe crear una actividad comercial con motivo cuando exista la migración aprobada.

## Tarea

### Estados

SQL y frontend soportan siete estados equivalentes:

`pending`, `ready`, `in_progress`, `blocked`, `in_review`, `completed`, `cancelled`.

La propuesta simplificada omite `ready` e `in_review`; no se recomienda eliminar esos estados porque ya están soportados y visibles.

| Estado inicial | Acción | Estado final | Actor permitido | Permitido por SQL | Requiere migración |
| --- | --- | --- | --- | --- | --- |
| `pending` | dejar lista para iniciar | `ready` | responsable/líder/admin | Sí | No |
| `ready` | iniciar trabajo | `in_progress` | responsable/líder/admin | Sí | No |
| `in_progress` | informar bloqueo | `blocked` | responsable/líder/admin | Sí | No |
| `blocked` | remover bloqueo | `in_progress` | responsable/líder/admin | Sí | No |
| `in_progress` | solicitar revisión | `in_review` | responsable/líder/admin | Sí | No |
| `in_review` | aprobar trabajo | `completed` | líder/revisor/admin | Sí | No |
| `in_review` | solicitar ajustes | `in_progress` | líder/revisor/admin | Sí | No |
| `pending`/`ready`/`in_progress`/`blocked`/`in_review` | cancelar con motivo | `cancelled` | líder/admin | Sí | Motivo/historial futuro opcional |
| `completed` | reabrir por corrección | `in_progress` | líder/admin | Sí | No; auditar |
| `cancelled` | reactivar excepcionalmente | `pending` | admin | Sí | No; auditar |

Reglas adicionales:

- La UI Kanban permite cualquier movimiento entre columnas visibles; el backend solo acepta la tabla anterior.
- `completed` y `cancelled` son terminales para el flujo ordinario; sus salidas son administrativas.
- Completar exige permiso y no puede confiar en que el actor enviado por el cliente sea el responsable.
- Los comentarios de tarea son MVP, pero requieren una migración futura. El registro detallado de tiempo queda fuera del MVP; se documenta como modelo futuro en `phase-0-decisions.md`.

## Ticket

### Estados

SQL y frontend soportan:

`new`, `classifying`, `assigned`, `in_progress`, `pending_client`, `resolved`, `closed`, `reopened`, `cancelled`.

La máquina conceptual solicitada se mapea sin crear estados nuevos: `open`→`new`, `triaged`→`classifying`/`assigned`, `waiting_client`→`pending_client`. El estado `reopened` ya existe.

| Estado inicial | Acción | Estado final | Actor permitido | Permitido por SQL | Requiere migración |
| --- | --- | --- | --- | --- | --- |
| `new` | iniciar clasificación | `classifying` | soporte/admin | Sí | No |
| `classifying` | asignar responsable | `assigned` | soporte/líder/admin | Sí; DB no exige assignee | No; backend exige assignee |
| `assigned` | iniciar atención | `in_progress` | responsable/soporte/líder/admin | Sí | No |
| `in_progress` | solicitar información | `pending_client` | responsable/soporte | Sí | No |
| `pending_client` | cliente responde | `in_progress` | cliente autorizado o responsable | Sí | No |
| `in_progress` | resolver con descripción | `resolved` | `tickets.resolve` | Sí, exige resolución y `resolved_at` | No |
| `resolved` | confirmar solución | `closed` | solicitante o cliente autorizado; soporte según política | Sí, exige `closed_at` | Permisos/historial futuro recomendados |
| `resolved` | rechazar solución | `reopened` | solicitante o cliente autorizado | Sí si `closed_at` es nulo | Historial de transición recomendado |
| `closed` | reabrir con motivo | `reopened` | actor con permiso explícito | Sí si se limpia `closed_at` | Permiso e historial recomendados |
| `reopened` | reasignar | `assigned` | soporte/líder/admin | Sí | No |
| `reopened` | retomar atención existente | `in_progress` | responsable/soporte/líder/admin | Sí | No |
| cualquier no terminal | cancelar con motivo | `cancelled` | soporte/líder/admin | Sí si `closed_at` es nulo | Historial recomendado |
| `cancelled` | reactivar excepcionalmente | `reopened` | admin con motivo | Sí | No; auditar |

Reglas adicionales:

- `resolved` exige `resolution` no vacía y `resolved_at`; `closed` exige además `closed_at`.
- Al reabrir un ticket cerrado se debe poner `closed_at = NULL` en la misma operación. La resolución anterior puede conservarse como evidencia, pero una nueva resolución debe quedar diferenciada en historial.
- El cliente no recibe `tickets.change_status` genérico. La API futura debe expresar intenciones `confirm-resolution` y `reject-resolution`.
- El rechazo exige comentario/motivo y produce `reopened`.
- Reabrir desde `closed` exige permiso separado y motivo.
- `cancelled` es terminal ordinario; solo administración puede reactivar.
- La UI interna ofrece todos los estados desde un selector y puede violar invariantes SQL. El backend nunca expondrá ese selector como autorización.
- La UI del portal solo muestra confirmación cuando existe resolución y estado `resuelto`, lo cual sí coincide con el diseño.

## Historial y migraciones recomendadas, no ejecutadas

Las tres máquinas pueden imponerse en servicios sin cambiar sus estados SQL. Para trazabilidad completa se recomiendan, en una fase autorizada posterior:

- `lead_activities` para notas, llamadas, correos manuales, reuniones, cambios de estado y próxima acción;
- `ticket_transition_events` con estado anterior/final, acción, actor, organización, motivo y fecha;
- permisos `tickets.confirm_resolution`, `tickets.reject_resolution` y `tickets.request_reopen`;
- `task_comments` para comentarios de tareas;
- opcionalmente historial específico de tareas si los eventos de auditoría no bastan para reportes.

No se ejecutó ninguna de estas migraciones.
# Implementación de Fase 6

La máquina de Ticket descrita abajo quedó implementada en
`src/common/state-machines/ticket-transitions.ts` sin añadir estados. Las
transiciones genéricas de cliente siguen prohibidas. Confirmar produce
`closed`; rechazar produce `reopened` y exige motivo. Cerrar/reabrir mantienen
`closed_at`, resolver mantiene `resolution/resolved_at`, y toda mutación usa
lock y conflicto seguro.
