# Acciones de tickets para clientes

Estado: diseño para Fase 3; no implementado.

| Permiso | Estado inicial | Resultado | Actor/propiedad | Auditoría |
| --- | --- | --- | --- | --- |
| `tickets.confirm_resolution` | `resolved` | `closed`; `closed_at=now()` | requester, contacto asignado o manager de la misma organización | actor, org, ticket, `resolved→closed`, request/idempotency key |
| `tickets.reject_resolution` | `resolved` | `reopened`, sin elección del cliente | mismos; motivo no vacío | motivo, resolución previa, transición y request ID |
| `tickets.request_reopen` | `closed` | crea intención; la regla aprobada transiciona controladamente a `reopened` | ticket propio/autorizado, misma org y ventana vigente | motivo, decisión/aprobador, timestamps |

Confirmar es idempotente: repetir la misma clave devuelve el resultado anterior; una clave nueva sobre `closed` no crea otra transición. Rechazar solo acepta `resolved`, exige motivo y nunca recibe `targetStatus`. Solicitar reapertura no expone una transición genérica; fuera de ventana o desde `new`, `classifying`, `assigned`, `in_progress`, `pending_client`, `reopened` o `cancelled` se deniega.

Los clientes no reciben `tickets.change_status` ni `tickets.close`. Tampoco pueden ver `ticket_comments.visibility='internal'`. Los comentarios cliente usan `ticket_comments.create_client` y el servidor fija `visibility='client'`.

Los archivos cliente requieren `files.read_client`/`files.upload_client`, padre autorizado y audiencia cliente demostrada. Para archivos de un comentario, el padre debe tener `visibility='client'`. Un archivo directo de ticket/proyecto sin señal persistente de audiencia se deniega; `classification='confidential'` no demuestra que sea visible al cliente.

Todas las mutaciones usan condición de estado en SQL/control optimista, transacción y un evento de auditoría; una carrera perdida devuelve conflicto seguro.
