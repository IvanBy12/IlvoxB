# Implementación de Clerk — Fase 3

Estado: implementado y probado mediante inyección de dependencias y el verificador oficial. No se usaron credenciales reales.

## Configuración

- `CLERK_AUTH_ENABLED`: habilita autenticación Clerk.
- `CLERK_PUBLISHABLE_KEY` y `CLERK_SECRET_KEY`: obligatorias cuando la autenticación está habilitada.
- `CLERK_AUTHORIZED_PARTIES`: lista de orígenes autorizados, obligatoria en ese modo.
- `CLERK_AUDIENCE`: audiencias opcionales del token.
- `CLERK_WEBHOOKS_ENABLED`: habilita `POST /webhooks/clerk`.
- `CLERK_WEBHOOK_SIGNING_SECRET`: obligatorio cuando los webhooks están habilitados.
- `DATABASE_URL`: obligatoria para procesar webhooks.

`src/config/env.ts` valida estas relaciones al iniciar. `.env.example` contiene solo placeholders. Los modos deshabilitados permiten ejecutar pruebas sin claves.

## Autenticación y perfil local

`src/plugins/clerk.ts` registra `@clerk/fastify` y obtiene únicamente el `userId` verificado mediante `getAuth`. `src/plugins/auth-context.ts` resuelve ese valor contra `app_users.clerk_user_id`; nunca vincula por correo ni acepta roles, permisos, organización o metadata del navegador.

Una sesión Clerk válida todavía recibe 403 si el perfil local no existe o su estado no es `active`. El `ActorContext` se construye con roles, permisos y membresías activas leídos de PostgreSQL. Tokens, cookies, firmas y secretos están excluidos del contexto y redactados en logs.

## Flujo privado

1. Clerk valida sesión/token, expiración, audiencia y parte autorizada.
2. Se extrae `clerk_user_id`.
3. El repositorio carga el perfil local y únicamente membresías/organizaciones activas.
4. Se derivan roles, permisos y scopes; los grants organizacionales quedan ligados a la organización que los otorgó.
5. El hook instala `request.actor`; cada operación debe autorizar de nuevo acción, scope y recurso.

Las pruebas sustituyen el proveedor externo, no el servicio local de identidad. Esto permite cubrir token ausente, inválido y expirado sin credenciales reales.
