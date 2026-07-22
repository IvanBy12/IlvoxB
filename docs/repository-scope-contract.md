# Contrato de scope para repositorios — Fase 3

Estado: contrato implementado en helpers de scope y en el repositorio de archivos de Fase 3. Los demás repositorios de negocio siguen fuera de alcance.

```ts
type AuthorizedRepositoryScope =
  | { kind: "global"; actorId: string; crossOrganization: true }
  | { kind: "organization"; actorId: string; organizationIds: readonly string[] }
  | { kind: "assigned"; actorId: string; organizationIds: readonly string[] }
  | { kind: "own"; actorId: string; organizationIds: readonly string[] }
  | { kind: "public"; actorId?: string };
```

El scope solo lo crea el servicio de autorización. Los repositorios no reciben un objeto arbitrario del body ni ofrecen overload sin scope para recursos protegidos. La organización se compara dentro de la consulta SQL; autorizar después de `findById` está prohibido.

| Repositorio | Predicados mínimos |
| --- | --- |
| tickets | `organization_id IN (...)` y requester/assignee/proyecto para `own/assigned`; comentarios por audiencia |
| projects | organización + existencia en `project_members` para assigned |
| tasks | organización del padre + assignee/proyecto/ticket autorizado |
| files | organización + exactamente un padre autorizado + estado activo + audiencia; nunca solo object key |
| ticket comments | ticket ya scoped + `visibility='client'` para clientes |
| organizations | ID en membresías/grants; global solo con acción + `organizations.access_all` |
| users/memberships | target inferior y organización autorizada; excluir roles internos para manager cliente |
| audit | `organization_id IN (...)`; global solo `audit.read` + acceso transversal |

Conteos, agregaciones, búsqueda y paginación aplican el mismo predicado antes de `count`, `limit` y cursores. El cursor incluye contexto de scope firmado/validado para que cambiarlo no expanda resultados. Un scope vacío devuelve cero filas/denegación, nunca se interpreta como global.

Ejemplo seguro conceptual: `findAuthorizedTicket({ ticketId, scope })`; ejemplo prohibido para actor no global: `findTicketById(ticketId)` seguido de un `if` en memoria.
