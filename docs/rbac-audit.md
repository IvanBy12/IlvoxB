# Auditoría exacta de la semilla RBAC

Fecha: 2026-07-22  
Fuente: `ilvox_complete_reconstructed.sql`  
Checksum SHA-256: `46D9EDDF29A0ABC25091E43867D0AC6B11A1AE180BDDF12665254BE9CD178CD6`

## Método

La semilla fue analizada directamente con `scripts/audit-rbac.mjs`. El script separa los `INSERT` de roles y permisos y el CTE `permission_role_map`; luego verifica referencias, duplicados y cobertura. Comando reproducible:

```powershell
node scripts/audit-rbac.mjs C:\ruta\ilvox_complete_reconstructed.sql
node scripts/audit-rbac.mjs C:\ruta\ilvox_complete_reconstructed.sql --matrix
```

## Resultado exacto

| Métrica | Resultado |
| --- | ---: |
| Roles | 11 |
| Permisos | 23 |
| Asociaciones totales | 142 |
| Asociaciones distintas | 142 |
| Asociaciones duplicadas | 0 |
| Referencias a roles inexistentes | 0 |
| Referencias a permisos inexistentes | 0 |
| Roles sin permisos | 0 |
| Permisos sin asignación | 0 |
| Diferencia numérica frente a la referencia histórica 125 | +17 |

La diferencia de contenido frente a las 125 asociaciones históricas no puede determinarse: el repositorio solo conserva la matriz de 142 filas y no contiene la lista anterior de 125. Es exacto afirmar que hay 17 filas más; no es posible identificar cuáles serían “las 17 adicionales” sin inventar una referencia perdida. El número 125 no se usa como regla de aceptación.

## Asignaciones por rol

| Alcance | Rol | Permisos |
| --- | --- | ---: |
| global | `super_admin` | 23 |
| global | `admin` | 23 |
| global | `sales` | 9 |
| global | `support_agent` | 13 |
| global | `project_lead` | 16 |
| global | `contributor` | 12 |
| organization | `client_manager` | 9 |
| organization | `client_contact` | 9 |
| project | `project_lead` | 14 |
| project | `project_member` | 10 |
| project | `project_viewer` | 4 |

## Asignaciones por permiso

| Permiso | Roles asignados |
| --- | ---: |
| `organizations.read` | 8 |
| `organizations.manage` | 3 |
| `leads.read` | 3 |
| `leads.manage` | 3 |
| `services.read` | 6 |
| `projects.read` | 10 |
| `projects.manage` | 4 |
| `tasks.read` | 7 |
| `tasks.manage` | 6 |
| `tickets.read` | 11 |
| `tickets.create` | 10 |
| `tickets.assign` | 5 |
| `tickets.change_status` | 7 |
| `tickets.resolve` | 5 |
| `tickets.close` | 5 |
| `ticket_comments.read_internal` | 7 |
| `ticket_comments.create_client` | 9 |
| `ticket_comments.create_internal` | 7 |
| `files.read` | 11 |
| `files.upload` | 9 |
| `users.manage` | 2 |
| `roles.manage` | 2 |
| `audit.read` | 2 |

## Hallazgos de seguridad

### Críticos

1. `global:admin` y `global:super_admin` tienen exactamente los mismos 23 permisos. La diferencia nominal no produce una diferencia efectiva de privilegios.
2. `admin` tiene `roles.manage` y `users.manage`. Si la futura API permite asignar cualquier rol o modificar cualquier usuario, un administrador puede elevarse a `super_admin`, elevar a terceros, bloquear superadministradores o eliminar el último actor de recuperación.

Recomendación: reservar la asignación/revocación de `super_admin` al propio `super_admin`; prohibir autoelevación, proteger al último superadministrador activo, imponer una jerarquía de roles y auditar actor, objetivo, valores anterior/nuevo y request ID.

### Altos

1. `organization:client_manager` y `organization:client_contact` tienen exactamente los mismos nueve permisos. La distinción de roles no tiene efecto.
2. Ambos roles reciben `tickets.change_status` y `tickets.close`. Estos permisos son más amplios que la intención aprobada de confirmar o rechazar una resolución. Sin política contextual permitirían ejecutar estados internos o cerrar tickets de otro solicitante dentro de la organización.
3. `tickets.read` y `files.read` están asignados a todos los roles. Esto es válido únicamente si cada consulta combina el permiso con el alcance efectivo del rol y el padre del recurso.

Recomendación: proponer en una migración futura `tickets.confirm_resolution` y `tickets.reject_resolution`, retirar `tickets.change_status` de roles de organización y decidir si `client_contact` queda limitado a proyectos asignados mientras `client_manager` conserva alcance organizacional.

### Medios

1. Los permisos no codifican alcance. `projects.read`, por ejemplo, solo expresa una capacidad; el backend debe resolver si proviene de rol global, membresía de organización o asignación de proyecto.
2. Los roles globales de negocio (`sales`, `support_agent`, `project_lead`, `contributor`) pueden leer organizaciones. El alcance transversal puede ser legítimo, pero debe quedar explícito y probado.
3. `contributor` y `project_member` pueden crear comentarios internos y leer comentarios internos en su alcance. Debe confirmarse que es necesario para todos los colaboradores.
4. `files.upload` no distingue clasificación o tipo de padre. La autorización debe comprobar organización, proyecto/ticket, visibilidad, estado y política de archivo.
5. Hallazgo histórico resuelto en Fase 4.5: `services.manage` se agrega mediante 0005 solo a
   super_admin y admin; la migración está validada pero no aplicada sobre `public`.

## Cruce de organizaciones

Ningún permiso por sí solo debe construir un filtro SQL. Las reglas aprobadas son:

- rol global: alcance transversal solo donde la política del rol lo permita;
- `client_manager`: todos los proyectos de su organización;
- miembro normal de organización: solo proyectos con asignación;
- rol de proyecto: solo el proyecto de la asignación;
- tickets, comentarios y archivos: heredan y revalidan el alcance del recurso padre;
- IDs aportados por params, query o body nunca amplían el alcance.

El esquema RBAC puede expresar los tres alcances, pero la semilla no impide cruces automáticamente. La prevención es responsabilidad conjunta de `AuthorizationService`, servicios y repositorios, con pruebas negativas entre dos organizaciones.

## Conclusión

Las 142 asociaciones son **estructuralmente válidas**: no contienen duplicados, referencias inexistentes ni elementos sin cobertura. Sin embargo, **necesitan correcciones antes de producción** por equivalencia total entre `admin`/`super_admin`, equivalencia total entre `client_manager`/`client_contact` y permisos de transición/cierre demasiado amplios para clientes.

La semilla no se modifica en esta fase. Las correcciones deberán presentarse como una migración/seed explícita, con diff de permisos y pruebas de no escalación.
