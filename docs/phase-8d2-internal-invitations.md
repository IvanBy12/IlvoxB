# Fase 8D.2 — invitaciones internas

## Contratos, roles y autoridad

`GET /api/v1/internal-roles` devuelve únicamente roles globales internos asignables por el actor. `GET|POST /api/v1/internal-invitations`, `POST /api/v1/internal-invitations/:invitationId/resend|revoke` administran el historial y `POST /api/v1/internal-invitations/claim` acepta una invitación desde una sesión Clerk. Listar, crear, reenviar y revocar exige actor interno activo y `users.manage`; claim exige sesión Clerk y correo verificado.

Los roles internos actuales son `super_admin`, `admin`, `sales`, `support_agent`, `project_lead` y `contributor`. En 8D.2 `super_admin` no es asignable. `client_manager` y `client_contact` son roles de organización y nunca aparecen. Para los demás roles el backend comprueba que cada permiso del rol solicitado ya esté contenido en las capacidades globales efectivas del invitador. Así no se confía en correo, UUID ni decisiones del navegador, y un actor no puede invitar un rol con mayor capacidad que la propia.

El body de creación acepta exclusivamente `email` y `roleCode`; claim acepta exclusivamente `invitationId`. PostgreSQL decide rol, status, asignabilidad y audiencia. Las respuestas no exponen IDs de invitación Clerk, tokens, scopes ni metadata de identidad.

## Lifecycle y separación

La migración `0012_phase8d2-internal-invitations.sql` crea `internal_user_invitations`: correo normalizado, FK `RESTRICT` al rol e identidades, estados `pending|accepted|expired|revoked`, timestamps de lifecycle, unicidad de invitación pendiente por correo e índices de correo, status y correlación Clerk. No existe borrado físico en la API. El historial de reenvío se preserva revocando el registro anterior y creando uno nuevo antes de emitir otro enlace.

Para una identidad nueva, ILVOX reserva primero la invitación local y Clerk emite el correo con `ilvox_internal_invitation=<UUID>`. Tras crear credenciales, el webhook sincroniza `app_users`; claim verifica correo, espera el perfil local, activa únicamente `pending`, asigna el rol global y marca la invitación aceptada en una transacción. Un webhook retrasado produce `PROFILE_NOT_SYNCHRONIZED` 409 con `retryable: true`; la UI aplica seis intentos acotados y después permite retry manual.

Si Clerk ya contiene una identidad verificada, el backend no crea otra. Si el `app_user` está sincronizado y no está bloqueado/eliminado ni posee ya acceso interno, crea historial aceptado, asigna el rol y devuelve `existing_account_granted`. Una cuenta cliente puede volverse dual solamente mediante esta invitación interna explícita: conserva memberships de organización y suma un rol global; nunca se transforman ni eliminan memberships.

El flujo cliente continúa separado: `ilvox_invitation` llama `/client-invitations/claim` y termina en `/portal`; `ilvox_internal_invitation` llama `/internal-invitations/claim`, confirma audiencia interna en `/me` y termina en `/app`. Cada endpoint consulta su propia tabla, por lo que los UUID no son intercambiables.

Reenvío admite `pending` o `expired`, invalida el enlace Clerk anterior, limita a cinco solicitudes por hora y conserva historial. Revocación es idempotente para `revoked`; no retira acceso ya aceptado. Se auditan `internal_user.invited`, `internal_user.invitation_resent`, `internal_user.invitation_revoked`, `internal_user.invitation_accepted`, `internal_user.existing_account_granted` e `internal_user.role_granted` sin secretos ni correos en payloads de auditoría.

La superficie `/app/personal` es opcional: con cero invitaciones indica que ILVOX funciona normalmente con su único operador. Esta fase no añade bloqueo, desactivación, edición posterior de roles, múltiples roles, permisos individuales, equipos ni administración completa de Personal.
