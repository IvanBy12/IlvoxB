# Idempotencia de webhooks Clerk — Fase 3

Ruta pública firmada: `POST /webhooks/clerk`. Eventos soportados: `user.created`, `user.updated` y `user.deleted`.

El parser Fastify entrega un `Buffer` sin reconstruir JSON. `@clerk/backend/webhooks.verifyWebhook` valida sobre ese cuerpo exacto y los encabezados `svix-*`; solo después se parsea el buffer original para conservar el timestamp del evento. Firma ausente/inválida, timestamp fuera de tolerancia, JSON inválido o evento no soportado producen 400 genérico.

## Transacción

1. Calcular SHA-256 del payload crudo.
2. Tomar advisory lock por ID externo y bloquear la fila del evento.
3. Detectar colisión de ID/tipo/hash y duplicado ya procesado.
4. Insertar o reintentar con contador de intentos.
5. Bloquear/upsert del usuario usando `clerk_user_id`.
6. Aplicar solo email primario, nombres y avatar; nunca roles, permisos, membresías o estado operativo protegido.
7. Marcar `processed` dentro de la misma transacción.

Un duplicado procesado responde éxito sin efectos repetidos. Los fallos hacen rollback de usuario y guardan únicamente `PROCESSING_FAILED` y texto redactado; un retry posterior puede completar. `last_synced_at` impide que un evento antiguo reemplace uno más nuevo. Una eliminación que llega antes de la creación crea un tombstone `deleted` con correo sintético no enrutable y hash del ID, evitando resurrección por eventos antiguos sin conservar payload completo.
