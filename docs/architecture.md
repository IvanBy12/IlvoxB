# Arquitectura del backend ILVOX

Fecha de corte: 23 de julio de 2026.

## Capas

El backend usa Fastify como transporte, servicios de aplicación para reglas de negocio y
repositorios PostgreSQL para persistencia. Los handlers validan y traducen HTTP, pero no
deciden permisos ni filtran recursos después de cargarlos.

```text
HTTP route -> schema -> service -> AuthorizationService -> repository scoped SQL
                                              \-> transaction + audit_events
```

PostgreSQL y las migraciones aplicadas son la fuente estructural de verdad. Drizzle refleja
ese modelo; no autoriza crear relaciones o columnas por conveniencia.

## Identidad y autorización

- Clerk autentica sesiones personales.
- `app_users` vincula el `clerk_user_id` con la identidad local.
- Roles, permisos y membresías viven en PostgreSQL.
- `ActorContext` contiene únicamente roles y membresías locales activos.
- `AuthorizationService` resuelve un `AuthorizedRepositoryScope`.
- El repositorio incorpora ese scope en datos, conteos, búsquedas y paginación.

## Módulos funcionales vigentes

- Fases 0–3.5: salud, Clerk, `/me`, webhooks, RBAC y contratos de archivos.
- Fases 4–4.5: catálogo administrable, captación y operación de leads, conversión standalone
  u organizacional, organizaciones opcionales y membresías locales.
- Fase 5: proyectos tenant-bound, miembros y roles de proyecto, hitos, entregables, tareas de
  proyecto y tareas internas standalone.

El permiso `services.manage` está versionado en 0005. Los contactos empresariales permanecen
fuera del runtime y no se usa `organization_memberships` como sustituto.

## Transacciones y auditoría

Las escrituras sensibles se realizan en una transacción que incluye `audit_events`.
La conversión bloquea el lead con `FOR UPDATE`, exige `approved`, crea o reutiliza una
organización de forma explícita y actualiza el vínculo y estado de manera atómica.

Fase 5 bloquea proyectos, tareas, hitos y entregables antes de mutarlos. Las transiciones
comparan el estado observado y los PATCH/asignaciones pueden comparar `expectedUpdatedAt`.
Crear hijos bloquea el proyecto para impedir escrituras posteriores a `delivered` o
`cancelled`.

Auditoría conserva metadatos mínimos. Correo, teléfono, mensaje, descripción, NIT
normalizado, tokens, secretos y payloads completos quedan excluidos.

## Contextos de Fase 5

Los proyectos siempre tienen organización. Miembros, hitos, entregables y tareas de proyecto
derivan ese contexto del proyecto y conservan las FK compuestas actuales.

Una tarea standalone tiene los tres campos contextuales nulos y se autoriza mediante scopes
internos `global|assigned|own`; `NULL` nunca significa público ni tenant compartido. El runtime
de Fase 5 excluye tareas de tickets.

## Archivos

Una futura relación de archivos desde estos módulos deberá combinar scope organizacional,
audiencia, estado `active`, exclusión de cuarentena/estados no disponibles y autorización
del recurso padre. No se emiten URLs públicas permanentes. Fase 4 no devuelve archivos.

## Plataforma

PostgreSQL 18.x es la versión oficial; PostgreSQL 18.4 es la validada. Staging y producción
deben permanecer en 18.x salvo nueva decisión arquitectónica.
