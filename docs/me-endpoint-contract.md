# Contrato implementado de `GET /me`

Estado: endpoint privado creado y probado en Fase 3.

Respuesta autenticada propuesta:

```json
{
  "user": { "id": "local-uuid", "status": "active", "primaryEmail": "redacted@example" },
  "organizations": [{ "id": "uuid", "membershipStatus": "active", "role": "client_contact" }],
  "roles": [{ "code": "client_contact", "scope": "organization", "organizationId": "uuid" }],
  "effectivePermissions": [{ "code": "tickets.read", "scopes": ["own", "assigned"], "scopeOrganizationIds": { "own": ["uuid"], "assigned": ["uuid"] } }],
  "capabilities": { "canCreateTicket": true, "canManageMembers": false }
}
```

No devuelve Clerk token, secretos, metadata no confiable, roles inactivos, asociaciones de otros usuarios ni detalles de políticas internas. Estado no activo produce denegación, no un contexto parcial privilegiado.

`capabilities` sirve para interfaz y puede incluir versión/expiración corta para refresco, pero **nunca es barrera de autorización**: cada endpoint recompone actor, permiso, scope, recurso y estado. Un cliente que modifique esta respuesta o envíe roles/permisos es ignorado.

Para múltiples membresías, la respuesta lista solo activas. La selección de organización en UI es una preferencia; el backend valida que esté en el `ActorContext` y en el recurso real.
