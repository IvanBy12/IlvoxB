# Contrato de AuthorizationService — Fase 3

Estado: implementado y probado en Fase 3. Véase `authorization-implementation.md`.

```ts
interface AuthorizationRequest {
  actor: ActorContext;
  action: string;
  requestedScope?: "global" | "organization" | "assigned" | "own" | "public";
  organizationId?: string;
  resourceType?: string;
  resourceId?: string;
  resourceOwnerId?: string;
  resourceAssigneeIds?: readonly string[];
  resourceState?: string;
  requestedRole?: { scope: "global" | "organization" | "project"; code: string };
  idempotencyKey?: string;
}

type InternalReasonCode =
  | "ALLOW"
  | "AUTHENTICATION_REQUIRED"
  | "LOCAL_PROFILE_MISSING"
  | "ACTOR_INACTIVE"
  | "MEMBERSHIP_REQUIRED"
  | "ROLE_INVALID"
  | "PERMISSION_DENIED"
  | "SCOPE_MISMATCH"
  | "ORGANIZATION_MISMATCH"
  | "RESOURCE_NOT_AUTHORIZED"
  | "RESOURCE_STATE_INVALID"
  | "PRIVILEGE_BOUNDARY"
  | "LAST_SUPER_ADMIN_PROTECTED";

interface AuthorizationDecision {
  allowed: boolean;
  reasonCode: InternalReasonCode;
  appliedScope?: "global" | "organization" | "assigned" | "own" | "public";
  repositoryScope?: AuthorizedRepositoryScope;
  auditRequired: boolean;
}
```

Orden: autenticación → perfil activo → rol/membresía → permiso → scope → organización → recurso/ownership/asignación/audiencia → estado/transición → guardas privilegiadas. La primera condición fallida deniega; ninguna rama “desconocida” permite.

Los reason codes detallados son internos. La API publica `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404 para ocultar existencia) o `CONFLICT` (409 por estado/concurrencia), con request ID; no revela si existe un UUID ajeno, qué permiso falta ni roles de terceros.

`can` devuelve decisión para composición interna; `assertAllowed` detiene la operación. Ninguna decisión sustituye el filtro de repositorio. Cambios de roles/seguridad exigen transacción, lock, idempotency key y auditoría. `roles.assign_super_admin` exige actor superadmin efectivo, target activo, no autoasignación y protección del último superadmin; la exigencia de sesión reciente queda como endurecimiento futuro.
