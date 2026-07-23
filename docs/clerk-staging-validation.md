# Validación Clerk staging — Fase 3.5

Fecha de cierre: 23 de julio de 2026.  
Estado: **aprobada con evidencia runtime en la instancia Clerk Development usada para integración**.

## Configuración validada

- La instancia quedó configurada manualmente como `Membership optional / Personal Accounts`.
- ILVOX no crea ni usa organizaciones de Clerk. Las organizaciones, membresías y RBAC permanecen en PostgreSQL.
- La sesión personal real quedó `active`, sin `currentTask`, y produjo un session token aceptado por `@clerk/fastify`.
- El backend temporal usó `CLERK_AUTH_ENABLED=true`, `CLERK_AUTHORIZED_PARTIES=http://localhost:4173` y acceso a la infraestructura de verificación de Clerk.
- El Signing Secret rotado aprobó un smoke corto `user.created`/`user.deleted`; no se repitió la auditoría exhaustiva del webhook ya aprobada.

## Alcance ejecutado

- Sin token y token inválido: `401 UNAUTHENTICATED`.
- Session token real válido y vínculo por `clerk_user_id`.
- Perfil local ausente, `pending`, `blocked` y `deleted`: `403 FORBIDDEN`.
- Perfil activo como cliente A, cliente B, multi-organización, interno limitado, `admin` y `super_admin`.
- `GET /me`: estado, tipo de usuario, membresías activas, roles, permisos efectivos y capacidades.
- Membresía revocada: omitida de `/me` y sin acceso a la organización.
- Aislamiento A/B, UUID ajeno, usuario interno sin alcance transversal, búsqueda, count y paginación.
- Archivos `organization`/`internal`, cross-org, cuarentena, carga directa y ausencia de URL pública permanente.
- Escalación vertical y señal `auditRequired` para acciones sensibles.

El estado `inactive` no pertenece al enum de `app_users`; el cierre fail-closed para un valor no soportado permanece cubierto por la suite local. La inactividad real de acceso organizacional se representó mediante membresía `revoked`.

## Economía y limpieza

Se reutilizó un único usuario Clerk temporal para todos los perfiles locales. No se creó ninguna organización ni membresía de Clerk. Al finalizar se eliminaron el usuario Clerk, dos organizaciones locales, cinco archivos de fixture, el estado temporal, las sesiones y las herramientas auxiliares.

## Salvedades

- Token expirado/revocado conserva cobertura automatizada local; el runtime externo validó token real válido, ausente e inválido sin persistir tokens.
- Los endpoints HTTP de archivos usados fueron un harness temporal sobre servicios/policies existentes; no son implementación de Fase 4.
- Un listado temporal que omitió aplicar la policy por fila mostró que un futuro endpoint debe filtrar estados no activos. La descarga en cuarentena sí devolvió `403`. Este requisito queda explícito para Fase 4.
