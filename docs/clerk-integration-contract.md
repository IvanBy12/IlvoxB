# Contrato de integración con Clerk — Fase 3

Estado: implementado en Fase 3. Detalle operativo en `clerk-implementation.md`.

## Autoridad y confianza

Clerk autentica y entrega un identificador verificado. PostgreSQL autoriza: estado de `app_users`, roles, membresías, permisos y scope se cargan localmente. Nunca se aceptan como autoridad `userId`, rol, permiso, organización o metadata enviados por frontend; tampoco se conserva el token completo en `ActorContext` o logs.

```ts
type LocalUserStatus = "pending" | "active" | "blocked" | "deleted";
type RoleScope = "global" | "organization" | "project";
type AccessScope = "global" | "organization" | "assigned" | "own" | "public";

interface OrganizationMembershipContext {
  organizationId: string;
  roleId: string;
  roleCode: string;
  status: "pending" | "active" | "revoked";
}

interface RoleContext {
  roleId: string;
  code: string;
  scope: RoleScope;
  organizationId?: string;
  projectId?: string;
}

interface PermissionContext {
  code: string;
  scopes: readonly AccessScope[];
  scopeOrganizationIds?: Partial<Record<AccessScope, readonly string[]>>;
}

interface ActorContext {
  clerkUserId: string;
  localUserId: string;
  status: LocalUserStatus;
  internal: boolean; // derivado de roles locales, nunca de metadata Clerk
  memberships: readonly OrganizationMembershipContext[];
  roles: readonly RoleContext[];
  permissions: readonly PermissionContext[];
}
```

La resolución por request verifica token/firma/issuer/audience/exp según configuración, busca `app_users.clerk_user_id`, exige `active` y carga contexto en una lectura consistente. Un usuario Clerk válido sin perfil local recibe denegación estable; el request no crea implícitamente el perfil.

Eventos y sincronización están en `clerk-webhook-contract.md`; `/me` en `me-endpoint-contract.md`. Secretos solo por variables/secret manager, nunca en repositorio, respuesta o auditoría.

Implementación final: `@clerk/fastify` autentica y `app_users.clerk_user_id` vincula. Los grants organizacionales se particionan por scope para que permisos procedentes de roles distintos no se mezclen entre organizaciones.
