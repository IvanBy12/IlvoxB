# Causa raíz del webhook de Clerk

Fecha: 22 de julio de 2026.  
Estado: **resuelta en la base local de desarrollo**.

## Incidente

El backend de Fase 3 recibió un `user.created` real y alcanzó el procesador PostgreSQL, pero la primera consulta sobre `identity_webhook_events` falló con SQLSTATE `42703` (`undefined_column`).

La consulta requería `payload_sha256`; esa columna, junto con `clerk_occurred_at`, `received_at` y `last_error_code`, pertenece a `0003_phase3-clerk-event-idempotency.sql`.

## Causa raíz confirmada

- `DATABASE_URL` apuntaba correctamente a `GestionIlvox.public`.
- `GestionIlvox` es la base local de desarrollo, no producción.
- El código ejecutado ya correspondía a Fase 3.
- `public` permanecía intencionalmente en la baseline porque las migraciones de Fase 3 solo se habían validado en esquemas temporales.
- Por tanto, el código y el esquema físico estaban desalineados: no era un defecto de firma, relay, ruta HTTP, Drizzle ni PostgreSQL 18.4.

La ruta registrada por Fastify es `POST /webhooks/clerk`, sin prefijo de módulo. El backend escucha en `127.0.0.1:3001`. `POST /api/webhooks/clerk` no forma parte de las rutas finales.

## Corrección aplicada

Después de verificar la baseline exacta y crear un backup utilizable, se aplicaron exclusivamente y en orden:

1. `0001_phase3-rbac-separation.sql`
2. `0002_phase3-file-audience.sql`
3. `0003_phase3-clerk-event-idempotency.sql`

No se ejecutaron rollbacks, SQL manual, `drizzle-kit push`, cambios de frontend, commit ni push.

La consulta que antes fallaba ahora funciona. El reintento del mismo evento real fue aceptado y quedó `processed`; reintentos posteriores devolvieron éxito sin crear un segundo evento ni un segundo efecto.

## Prevención

- Mantener el preflight de esquema como requisito antes de iniciar una versión del backend que dependa de migraciones nuevas.
- Ejecutar el runbook y registrar versión de aplicación y versión de esquema como una unidad de despliegue.
- Conservar la clasificación `MIGRATION_REQUIRED` para SQLSTATE `42703` y `42P01`.
- No convertir errores internos en éxito artificial; la respuesta pública continúa siendo genérica y reintentable.

