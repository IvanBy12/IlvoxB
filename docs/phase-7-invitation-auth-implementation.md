# Fase 7.3 — Autenticación privada por invitación

Fecha: 28 de julio de 2026  
Alcance: sesión, invitación, sincronización de identidad, redirects y logout.  
Estado: **implementada; sin iniciar Fase 7.4**.

## Decisión de arquitectura

Clerk es responsable de identidad, credenciales, verificación y sesión.
PostgreSQL es la única autoridad para `app_users.status`, roles, memberships,
permisos efectivos y scopes. El frontend no crea ni activa perfiles locales y
no interpreta email, metadata o Clerk Organizations como autorización.

No se añadieron endpoints, migraciones, tablas, columnas, OpenAPI ni cambios
RBAC. El webhook existente continúa siendo el único mecanismo de sincronización
Clerk → PostgreSQL.

## Configuración efectiva de Clerk

La instancia de desarrollo se mantiene en el plan Hobby y quedó configurada así:

| Elemento | Estado |
| --- | --- |
| Sign-up mode | `Restricted mode` guardado |
| Email para sign-in | Habilitado |
| Contraseña | Habilitada |
| Código de verificación por email | Habilitado |
| Enlace de verificación por email | Deshabilitado |
| Conexiones sociales | Ninguna |
| SSO empresarial | Ninguna |
| Allowlist | No usada |
| Producción | No habilitada |

El modo restringido admite únicamente usuarios invitados o creados
explícitamente. No se habilitó ninguna función Pro.

## Login cerrado

`Login.tsx` utiliza el componente `SignIn` de Clerk sin `signUpUrl`, `SignUp`,
`SignUpButton`, Google One Tap ni proveedor social. Las subrutas de registro
conocidas se rechazan con una salida 404 neutral.

La recuperación, verificación y confianza de dispositivo permanecen a cargo
del flujo prebuilt de Clerk. ILVOX no captura ni persiste contraseñas, códigos o
session tokens.

## Aceptación de invitación

La única ruta de alta es:

```text
/invitacion/aceptar?__clerk_ticket=...
```

`InvitationAcceptance.tsx` usa `useSignUp` con estrategia `ticket`, compatible
con la versión instalada de `@clerk/clerk-react`. Permite nombre, apellido y
contraseña, confirma la contraseña, evita doble submit y reserva el contenedor
oficial de CAPTCHA.

La pantalla no solicita ni envía:

- role o role ID;
- organization o membership;
- status o activación;
- permisos o scope;
- `publicMetadata` o `unsafeMetadata`.

Un ticket ausente muestra 404 neutral. Los errores inválido, expirado, usado y
de contraseña se convierten en mensajes seguros, sin registrar el error crudo.

## Estados de identidad local

El backend devuelve:

| Estado PostgreSQL | Código HTTP/API | UI |
| --- | --- | --- |
| Sin fila local | 403 `PROFILE_NOT_SYNCHRONIZED` | Sincronización en curso + retry |
| `pending` | 403 `PROFILE_PENDING` | Acceso pendiente |
| `blocked`, `deleted` u otro no activo | 403 `PROFILE_INACTIVE` | Acceso deshabilitado |
| `active` | 200 | Perfil, permisos y scopes reales |

El retry automático tiene máximo tres intentos y solo aplica a
`PROFILE_NOT_SYNCHRONIZED`. Un perfil pendiente o inactivo nunca se activa ni se
reintenta automáticamente.

## Webhook

El endpoint existente procesa `user.created`, `user.updated` y `user.deleted`.
La implementación:

- verifica la firma sobre el body crudo;
- identifica eventos por ID/hash;
- serializa por `clerk_user_id` con advisory lock;
- ignora duplicados y eventos fuera de orden;
- crea perfiles en `pending`;
- conserva el status local en updates;
- aplica tombstone en delete;
- permite retry seguro tras un fallo transaccional.

No existe lookup de autenticación por email o metadata.

## Redirects, sesión y cache

Los redirects solo aceptan rutas locales exactas bajo `/app` o `/portal`.
Protocolos externos, URLs `//`, backslashes, `javascript:`, `data:` y rutas de
registro se descartan. Un deep link se conserva únicamente si `/me` confirma el
audience permitido.

Logout cancela y limpia el `QueryClient` antes de cerrar la sesión Clerk. Un
cambio de `userId` limpia la misma cache para impedir datos cruzados.

## Condiciones externas

No se envió una invitación real porque no se proporcionó un correo de prueba
controlado ni acceso a su bandeja. Tampoco se validó una entrega remota desde
Clerk al webhook local porque `127.0.0.1` no es públicamente alcanzable.

Antes de producción se debe:

1. invitar desde Clerk Dashboard un correo de prueba controlado;
2. aceptar el ticket y confirmar la creación `pending`;
3. exponer el webhook mediante una URL HTTPS autorizada;
4. confirmar `created`, `updated`, duplicado y `deleted` en el entorno objetivo.

Estas condiciones no requieren allowlist ni plan Pro.
