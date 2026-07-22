# Implementación de autorización contextual — Fase 3

Estado: implementado en `src/common/auth`.

`AuthorizationService` aplica denegación por defecto, estado local activo, permiso efectivo, scope solicitado, organización, ownership/asignación, estado del recurso y límites de privilegio. Expone `can`, `assertAllowed` y `resolveScope`. Un UUID de otra organización produce 404 cuando revelar existencia causaría una fuga; faltas de permiso o estado producen 403.

## ActorContext

Contiene solo `clerkUserId`, ID local, estado, clasificación interna derivada de roles globales, membresías activas, roles locales y permisos efectivos. `PermissionContext.scopeOrganizationIds` conserva la procedencia organizacional por scope: un rol manager en A no amplía un rol contact en B.

## Scopes

- `global`: solo si el permiso lo permite; cruzar organizaciones exige además `organizations.access_all`.
- `organization`: IDs concedidos por membresías/roles activos.
- `assigned`: organización concedida más asignación comprobada en SQL.
- `own`: organización concedida más ownership/requester/uploader comprobado en SQL.
- `public`: exige un indicador público explícito; para archivos operativos siempre produce cero filas.

`scope-filter.ts` genera predicados Drizzle reutilizables. `FileRepository` demuestra el patrón PostgreSQL para lectura individual, listas, búsqueda, conteos, paginación y agregación. No ofrece un método protegido sin scope.

## Reglas sensibles

Los cinco permisos globales sensibles son auditables. `super_admin` no es un bypass nominal: necesita `roles.assign_super_admin`; no puede autoasignarse; la mutación usa transacción, advisory lock, idempotencia y protege al último superadministrador activo. Un manager cliente solo puede administrar roles organizacionales `client_manager` o `client_contact`.

Las intenciones de ticket cliente traducen acciones cerradas a transiciones del servidor: confirmar `resolved → closed`, rechazar `resolved → reopened` con motivo y solicitar `closed → reopened` con motivo. El cliente no selecciona arbitrariamente el estado final.
