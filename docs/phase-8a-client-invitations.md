# Fase 8A — Invitaciones de clientes

## Persistencia y migración

`0009_phase8a-client-invitations.sql` crea `organization_invitations` y su snapshot Drizzle. Guarda organización, correo original/normalizado, rol cliente, estado (`pending`, `accepted`, `expired`, `revoked`), correlación Clerk, actor, aceptación, expiración y timestamps. Las FKs usan `ON DELETE RESTRICT`; hay checks explícitos de correo, rol, estado, ciclo de vida y expiración, más índices por organización, correo, estado y Clerk ID. Un índice parcial impide dos invitaciones pendientes para el mismo correo/organización. La migración se aplica con el migrador Drizzle; nunca con `drizzle-kit push`.

## Endpoints y flujo

- `GET|POST /api/v1/organizations/:organizationId/invitations`: lista o crea. El body de creación admite solo `email` y `membershipRole` (`client_manager` o `client_contact`).
- `POST /api/v1/organizations/:organizationId/invitations/:invitationId/resend`: reemplaza una invitación pendiente/expirada, revoca la referencia Clerk anterior y tiene límite de 5/hora.
- `POST /api/v1/organizations/:organizationId/invitations/:invitationId/revoke`: invalida Clerk y conserva el registro local; no revoca memberships aceptadas.
- `POST /api/v1/client-invitations/claim`: admite solo el UUID opaco local y requiere sesión Clerk activa.

Para una persona nueva, IlvoxB reserva primero la invitación local y crea después una invitación oficial Clerk con 30 días de validez. El redirect lleva `ilvox_invitation=<uuid>` a `/invitacion/aceptar`; Clerk añade `__clerk_ticket`. Tras configurar credenciales, IlvoxF conserva ambos valores, espera sesión activa y llama `claim`. IlvoxB vuelve a verificar los correos confirmados en Clerk, reclama transaccionalmente la invitación, activa un perfil local `pending`, crea/reactiva una única membership y audita una vez. Si el webhook aún no creó `app_users`, responde `PROFILE_NOT_SYNCHRONIZED` 409 con `retryable: true`; la UI reintenta como máximo seis veces y luego permite retry manual. Finalmente confirma la organización mediante `/me` y navega a `/portal`.

Si el correo corresponde exactamente a una identidad Clerk verificada existente, IlvoxB no crea otra identidad ni invitación Clerk: activa el perfil elegible y concede/reactiva la membership en una transacción. La respuesta `existing_account_granted` permite mostrar “El acceso fue concedido a una cuenta existente”. Perfiles `blocked` o `deleted` nunca se reactivan.

## Seguridad

Crear, listar, reenviar o revocar exige identidad interna, `organization_members.manage` y scope SQL sobre la organización. Un cliente no puede invitarse ni invitar a otros. La organización proviene de la ruta autorizada; rol final, estado, permisos y scopes provienen del registro local. `claim` no acepta organización ni rol, valida estado/expiración/correo/Clerk user y es idempotente. UUID ajeno al tenant se oculta con 403/404; payloads adicionales fallan. No se exponen ticket, tokens, secretos, metadata ni respuestas crudas de Clerk. Reenvío conserva historia local, evita enlaces activos múltiples y registra auditoría; revocación local bloquea el claim incluso si la revocación remota requiere retry.

## Pruebas y limitaciones

Las pruebas focalizadas cubren creación/listado, roles/payload, permisos y scope, usuario nuevo/existente, duplicado, expiración, reenvío, revocación, correo distinto, claim idempotente, webhook retrasado, 401/403/404/409/429 y OpenAPI. `PHASE8A_SMOKE_` valida PostgreSQL real, membership única, `/me`, auditoría, cross-tenant y limpieza (`residualFixtures: 0`). IlvoxF prueba contratos, mensajes seguros, ausencia de catálogos/Clerk browser API, retry acotado y redirect al portal.

Limitaciones: no se implementan Personal, catálogo general de usuarios, 7.6, 8B/8C, motor de reglas, archivos, notificaciones, auditoría UI ni RBAC administrativo. El mecanismo usado es la invitación de aplicación oficial disponible en `@clerk/backend` 3.12 (`createInvitation`, `redirectUrl`, `expiresInDays`, `revokeInvitation`); la metadata de Clerk no participa en autorización.
