# Máquina de estados de tickets

Estados PostgreSQL exactos:

`new`, `classifying`, `assigned`, `in_progress`, `pending_client`, `resolved`,
`closed`, `reopened`, `cancelled`.

Estado inicial: `new`.

| Desde | Hacia | Condición |
| --- | --- | --- |
| `new` | `classifying` / `cancelled` | cancelar exige motivo |
| `classifying` | `assigned` / `cancelled` | asignado exige responsable |
| `assigned` | `in_progress` / `cancelled` | flujo interno |
| `in_progress` | `pending_client` / `resolved` / `cancelled` | resolver exige texto |
| `pending_client` | `in_progress` / `cancelled` | respuesta del cliente |
| `resolved` | `closed` / `reopened` | confirmación o rechazo |
| `closed` | `reopened` | admin y motivo |
| `reopened` | `assigned` / `in_progress` / `cancelled` | retoma atención |
| `cancelled` | `reopened` | admin y motivo |

La máquina central está en
`src/common/state-machines/ticket-transitions.ts`. El servicio observa el
estado autorizado y el repositorio vuelve a bloquear con `FOR UPDATE`, compara
estado/`expectedUpdatedAt` y devuelve conflicto si perdió la carrera.

Resolver fija `resolution` y `resolved_at`; cerrar fija `closed_at`; toda salida
de `closed` limpia `closed_at`. Confirmar y rechazar no aceptan un estado
destino arbitrario.
