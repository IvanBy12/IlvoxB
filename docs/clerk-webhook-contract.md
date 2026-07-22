# Contrato de webhooks Clerk — Fase 3

Estado: implementado y probado en Fase 3.

Eventos previstos: creación, actualización y eliminación de usuario (`user.created`, `user.updated`, `user.deleted`, sujetos a confirmar contra la versión SDK/documentación elegida en Fase 3).

## Flujo

1. Limitar tamaño y capturar body crudo.
2. Verificar firma y timestamp con secreto del entorno antes de parsear/procesar; rechazar headers ausentes, firma inválida o replay fuera de tolerancia.
3. Usar el identificador único del evento como `identity_webhook_events.clerk_event_id`; el UNIQUE garantiza idempotencia.
4. En transacción, insertar `received` con `ON CONFLICT`; un evento ya `processed` responde éxito sin repetir efectos.
5. Tomar/actualizar estado `processing`, incrementar intentos, bloquear la fila de usuario y aplicar upsert/soft-delete local.
6. Marcar `processed` y `processed_at`; en error persistir `failed` y mensaje redactado. Reintentos con backoff y límite; dead-letter/alerta operacional futura.

`user.created/updated` sincronizan identificador, email primario, nombres/avatar permitidos y estado según política; nunca roles/permisos desde metadata. `user.deleted` marca `app_users.status='deleted'` y revoca acceso, sin borrado físico que rompa auditoría/FK.

## Orden y duplicados

`app_users.last_synced_at` se interpreta como timestamp de la versión de objeto Clerk aceptada, no hora de llegada. Bajo lock, un evento con versión/timestamp anterior no sobrescribe uno más nuevo; se registra como procesado obsoleto. Si el proveedor no ofrece un timestamp ordenable confiable para el evento elegido, la Fase 3 debe resolver el estado actual por API o proponer persistencia adicional antes de habilitar webhooks; no se usa orden de recepción como autoridad.

Una colisión del mismo `clerk_event_id` con payload/tipo distinto se trata como incidente, no como reintento válido. Logs contienen event ID, tipo, resultado y request ID; redactan firma, secreto, token, email completo y payload sensible.

La implementación usa `@clerk/backend/webhooks`, body crudo, advisory lock por event ID, SHA-256, transacción, retries y tombstone para eliminaciones que preceden una creación. Véase `webhook-idempotency.md`.
