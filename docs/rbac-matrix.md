+# Matriz RBAC preservada

Fecha: 2026-07-22  
Fuente: semilla de 142 asociaciones de `ilvox_complete_reconstructed.sql`.  
Esta matriz es descriptiva; no modifica la semilla. El alcance esperado indica el origen del rol. Toda autorización debe combinar permiso, alcance y recurso.

| Rol | Permiso | Alcance esperado | Riesgo | Recomendación |
| --- | --- | --- | --- | --- |
| `super_admin` | `organizations.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `admin` | `organizations.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `sales` | `organizations.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `support_agent` | `organizations.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `project_lead` | `organizations.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `contributor` | `organizations.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `client_manager` | `organizations.read` | organization | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `client_contact` | `organizations.read` | organization | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `organizations.manage` | global | Medio | Mantener solo si el rol necesita alcance transversal; auditar toda mutación. |
| `admin` | `organizations.manage` | global | Medio | Mantener solo si el rol necesita alcance transversal; auditar toda mutación. |
| `sales` | `organizations.manage` | global | Medio | Mantener solo si el rol necesita alcance transversal; auditar toda mutación. |
| `super_admin` | `leads.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `admin` | `leads.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `sales` | `leads.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `leads.manage` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `admin` | `leads.manage` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `sales` | `leads.manage` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `services.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `admin` | `services.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `sales` | `services.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `support_agent` | `services.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `services.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `contributor` | `services.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `projects.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `admin` | `projects.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `sales` | `projects.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `project_lead` | `projects.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `contributor` | `projects.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `client_manager` | `projects.read` | organization | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `client_contact` | `projects.read` | organization | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `projects.read` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_member` | `projects.read` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_viewer` | `projects.read` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `projects.manage` | global | Medio | Mantener solo si el rol necesita alcance transversal; auditar toda mutación. |
| `admin` | `projects.manage` | global | Medio | Mantener solo si el rol necesita alcance transversal; auditar toda mutación. |
| `project_lead` | `projects.manage` | global | Medio | Mantener solo si el rol necesita alcance transversal; auditar toda mutación. |
| `project_lead` | `projects.manage` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `tasks.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `admin` | `tasks.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `tasks.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `contributor` | `tasks.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `tasks.read` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_member` | `tasks.read` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_viewer` | `tasks.read` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `tasks.manage` | global | Medio | Mantener solo si el rol necesita alcance transversal; auditar toda mutación. |
| `admin` | `tasks.manage` | global | Medio | Mantener solo si el rol necesita alcance transversal; auditar toda mutación. |
| `project_lead` | `tasks.manage` | global | Medio | Mantener solo si el rol necesita alcance transversal; auditar toda mutación. |
| `contributor` | `tasks.manage` | global | Medio | Mantener solo si el rol necesita alcance transversal; auditar toda mutación. |
| `project_lead` | `tasks.manage` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_member` | `tasks.manage` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `tickets.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `admin` | `tickets.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `sales` | `tickets.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `support_agent` | `tickets.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `project_lead` | `tickets.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `contributor` | `tickets.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `client_manager` | `tickets.read` | organization | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `client_contact` | `tickets.read` | organization | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `tickets.read` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_member` | `tickets.read` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_viewer` | `tickets.read` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `tickets.create` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `admin` | `tickets.create` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `sales` | `tickets.create` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `support_agent` | `tickets.create` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `tickets.create` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `contributor` | `tickets.create` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `client_manager` | `tickets.create` | organization | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `client_contact` | `tickets.create` | organization | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `tickets.create` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_member` | `tickets.create` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `tickets.assign` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `admin` | `tickets.assign` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `support_agent` | `tickets.assign` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `tickets.assign` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `tickets.assign` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `tickets.change_status` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `admin` | `tickets.change_status` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `support_agent` | `tickets.change_status` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `tickets.change_status` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `client_manager` | `tickets.change_status` | organization | Alto | Sustituir por confirm/reject contextual o limitar a transiciones de cliente y tickets autorizados. |
| `client_contact` | `tickets.change_status` | organization | Alto | Sustituir por confirm/reject contextual o limitar a transiciones de cliente y tickets autorizados. |
| `project_lead` | `tickets.change_status` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `tickets.resolve` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `admin` | `tickets.resolve` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `support_agent` | `tickets.resolve` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `tickets.resolve` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `tickets.resolve` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `tickets.close` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `admin` | `tickets.close` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `support_agent` | `tickets.close` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `client_manager` | `tickets.close` | organization | Alto | Sustituir por confirm/reject contextual o limitar a transiciones de cliente y tickets autorizados. |
| `client_contact` | `tickets.close` | organization | Alto | Sustituir por confirm/reject contextual o limitar a transiciones de cliente y tickets autorizados. |
| `super_admin` | `ticket_comments.read_internal` | global | Medio | Comprobar alcance de ticket/proyecto antes de devolver comentarios internos. |
| `admin` | `ticket_comments.read_internal` | global | Medio | Comprobar alcance de ticket/proyecto antes de devolver comentarios internos. |
| `support_agent` | `ticket_comments.read_internal` | global | Medio | Comprobar alcance de ticket/proyecto antes de devolver comentarios internos. |
| `project_lead` | `ticket_comments.read_internal` | global | Medio | Comprobar alcance de ticket/proyecto antes de devolver comentarios internos. |
| `contributor` | `ticket_comments.read_internal` | global | Medio | Comprobar alcance de ticket/proyecto antes de devolver comentarios internos. |
| `project_lead` | `ticket_comments.read_internal` | project | Medio | Comprobar alcance de ticket/proyecto antes de devolver comentarios internos. |
| `project_member` | `ticket_comments.read_internal` | project | Medio | Comprobar alcance de ticket/proyecto antes de devolver comentarios internos. |
| `super_admin` | `ticket_comments.create_client` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `admin` | `ticket_comments.create_client` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `support_agent` | `ticket_comments.create_client` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `ticket_comments.create_client` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `contributor` | `ticket_comments.create_client` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `client_manager` | `ticket_comments.create_client` | organization | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `client_contact` | `ticket_comments.create_client` | organization | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `ticket_comments.create_client` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_member` | `ticket_comments.create_client` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `ticket_comments.create_internal` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `admin` | `ticket_comments.create_internal` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `support_agent` | `ticket_comments.create_internal` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `ticket_comments.create_internal` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `contributor` | `ticket_comments.create_internal` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_lead` | `ticket_comments.create_internal` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `project_member` | `ticket_comments.create_internal` | project | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `super_admin` | `files.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `admin` | `files.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `sales` | `files.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `support_agent` | `files.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `project_lead` | `files.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `contributor` | `files.read` | global | Medio | Combinar permiso con filtros de alcance; nunca autorizar solo por código. |
| `client_manager` | `files.read` | organization | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `client_contact` | `files.read` | organization | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `project_lead` | `files.read` | project | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `project_member` | `files.read` | project | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `project_viewer` | `files.read` | project | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `super_admin` | `files.upload` | global | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `admin` | `files.upload` | global | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `support_agent` | `files.upload` | global | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `project_lead` | `files.upload` | global | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `contributor` | `files.upload` | global | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `client_manager` | `files.upload` | organization | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `client_contact` | `files.upload` | organization | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `project_lead` | `files.upload` | project | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `project_member` | `files.upload` | project | Medio | Revalidar organización, padre, estado y visibilidad en cada operación. |
| `super_admin` | `users.manage` | global | Alto | Aplicar jerarquía: no bloquear ni modificar actores de mayor privilegio. |
| `admin` | `users.manage` | global | Alto | Aplicar jerarquía: no bloquear ni modificar actores de mayor privilegio. |
| `super_admin` | `roles.manage` | global | Crítico | Impedir que admin se eleve a super_admin y proteger el último superadmin. |
| `admin` | `roles.manage` | global | Crítico | Impedir que admin se eleve a super_admin y proteger el último superadmin. |
| `super_admin` | `audit.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |
| `admin` | `audit.read` | global | Bajo | Conservar con validación de alcance y pruebas negativas. |

## Lectura de riesgos

- **Crítico:** posible elevación o pérdida de control administrativo si no existen guardas jerárquicas.
- **Alto:** capacidad más amplia que la acción aprobada para el actor.
- **Medio:** válida solo con filtros contextuales y auditoría.
- **Bajo:** asignación razonable, todavía sujeta a validación de alcance.

La conclusión consolidada está en [rbac-audit.md](./rbac-audit.md).

