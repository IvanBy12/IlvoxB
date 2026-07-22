# Registro de decisiones de Fase 0

Fecha: 2026-07-22  
Estado general: aprobado para diseño del MVP. Las migraciones de brechas se documentan, pero no se crean en esta ejecución.

| ID | Decisión | Contexto y alternativas | Decisión adoptada | Consecuencias | Migración requerida | Aprobación |
| --- | --- | --- | --- | --- | --- | --- |
| D-001 | Notificaciones | Sin tabla; alternativas: omitir, servicio externo o persistencia local | Bandeja interna MVP; sin correo/SMS/push/preferencias/colas | Lectura y marcado; efectos transaccionales simples | Sí, futura `notifications` | Aprobada |
| D-002 | Actividad comercial | `leads` no conserva interacciones; alternativa CRM completo | Historial básico: nota, llamada, correo manual, reunión, cambio de estado y próxima acción | Trazabilidad comercial sin automatización de correo | Sí, futura `lead_activities` | Aprobada |
| D-003 | Comentarios de tareas | `tasks` no tiene conversación | Comentarios forman parte del MVP | Autores y alcance deben validarse; archivos se autorizan por tarea | Sí, futura `task_comments` | Aprobada |
| D-004 | Tiempo trabajado | Contador mutable vs entradas detalladas vs fuera de alcance | Fuera del MVP inicial; documentar `task_time_entries` | `estimated_minutes` permanece; no se reporta consumo real | Futura, no aprobada para ejecución | Aprobada |
| D-005 | SLA | Motor completo implicaría políticas, calendarios y pausas | Fuera del MVP; solo diseño futuro | No se agregan columnas SLA a tickets | Futura | Aprobada |
| D-006 | Avance de proyecto | Campo manual vs hitos vs tareas | Derivado: completadas / válidas × 100; excluir canceladas; 0 sin tareas | No se almacena ni edita; hitos/entregables siguen separados | No | Aprobada |
| D-007 | Visibilidad organizacional | Toda la org vs asignación por proyecto | manager ve toda su org; miembro normal solo proyectos asignados; internos por RBAC | Autorización siempre permiso + alcance + recurso | No necesariamente | Aprobada |
| D-008 | Prioridad de ticket | Una prioridad vs solicitada y efectiva | Mantener diferencia entre `requested_priority` y `priority` | Cliente no fija prioridad operativa definitiva | Historia futura recomendada | Aprobada |
| D-009 | Archivos | Binarios en DB vs filesystem/S3 | Puerto desacoplado con adaptador local, S3-compatible y falso | DB solo metadatos; autorización en cada operación | No para puerto; posibles ajustes futuros | Aprobada |
| D-010 | Contenido público | CMS vs estático | Marketing estático en frontend durante MVP | No crear CMS; servicios operativos sí vienen de PostgreSQL | No | Aprobada |
| D-011 | Ticket ampliado | SQL actual vs equipo, servicio, categoría e historial | Diseñar capacidades; no agregar relaciones sin migración aprobada | Núcleo actual se conserva; brechas quedan propuestas | Sí, futura | Aprobada |
| D-012 | Baseline | SQL original vs migración regenerada por ORM | SQL original es fuente de verdad; Drizzle lo mapea y no lo reemplaza silenciosamente | Base nueva ejecuta baseline; base existente se reconoce tras comprobar paridad | No destructiva | Aprobada |
| D-013 | Módulos/ESM | CommonJS vs ESM | ESM (`type: module`, NodeNext) | Imports explícitos y configuración uniforme | No | Aprobada técnica |
| D-014 | Validación de entorno | Valores dispersos vs schema único | Zod valida al arrancar; tests pueden inyectar entorno | Fallo temprano y mensajes sin secretos | No | Aprobada técnica |
| D-015 | RBAC semilla | Forzar 125 vs preservar 142 | Preservar 142 y auditar; no modificar en esta ejecución | Requiere corrección explícita antes de producción | Seed futura | Aprobada |

## Modelos futuros recomendados

### Notificaciones

Entidad propuesta `notifications`:

- `id uuid`;
- `user_id uuid NOT NULL`;
- `organization_id uuid NULL` para contexto;
- `type varchar` con catálogo reducido;
- `title varchar`, `message text`;
- `link text NULL` o payload de navegación validado;
- `payload jsonb NULL`, objeto sin secretos;
- `read_at timestamptz NULL`;
- `created_at timestamptz NOT NULL`.

Índices: `(user_id, read_at, created_at DESC)` y retención por fecha. No incluye preferencias, reintentos ni canales externos.

### Actividad comercial

Entidad propuesta `lead_activities`:

- `id`, `lead_id`, `actor_user_id`;
- `type`: `note|call|manual_email|meeting|status_change|next_action`;
- `content` o resumen;
- `occurred_at`;
- `previous_status/new_status` solo para cambio de estado;
- `next_action_at` solo para próxima acción;
- `created_at`.

Debe ser append-only para el historial. Las correcciones se registran con un nuevo evento o metadato de anulación auditado.

### Comentarios y tiempo de tareas

`task_comments`: `id`, `task_id`, `organization_id` opcional según contexto, `author_user_id`, `content`, `created_at`, `updated_at`. La visibilidad inicial es interna; si más adelante se expone al cliente debe agregarse explícitamente y no inferirse.

`task_time_entries` futuro, fuera del MVP: `id`, `task_id`, `user_id`, `started_at`, `ended_at`, `minutes`, `description`, `created_at`, con regla que impida duración negativa y defina si se admiten entradas manuales. No se crea migración ahora.

### SLA futuro

Modelo sugerido:

- `sla_policies`: organización/servicio, prioridad efectiva, minutos de primera respuesta y resolución, calendario y estado;
- `ticket_sla_instances`: política congelada aplicada al ticket, deadlines calculados y timestamps de cumplimiento;
- `ticket_sla_pauses`: inicio, fin y motivo de cada pausa;
- opcional `business_calendars` para horario laboral y festivos.

Eventos:

- inicia al crear/aceptar el ticket según política;
- primera respuesta termina su cronómetro con el primer comentario público válido de un interno;
- resolución termina al pasar a `resolved`;
- `pending_client` puede pausar si la política lo permite;
- volver a `in_progress` reanuda;
- `cancelled` finaliza sin cumplimiento;
- reapertura crea un nuevo tramo o reactiva el existente según política futura.

No se agregan columnas SLA a `tickets` en el MVP.

### Prioridad solicitada y efectiva

El SQL actual ya contiene:

- `requested_priority`: propuesta por el solicitante;
- `priority`: valor operativo efectivo.

Por tanto, no se necesita una migración para separar ambos valores. Para explicar cada ajuste se recomienda posteriormente `ticket_priority_changes`:

- `ticket_id`;
- `from_priority`, `to_priority`;
- `changed_by_user_id` (responsable del cambio);
- `reason` (motivo obligatorio);
- `changed_at` (fecha);
- `request_id` para enlazar auditoría.

Cada cambio también debe escribir `audit_events` en la misma transacción. No se crea esa tabla ahora.

### Archivos

Contrato de almacenamiento:

- `createUploadIntent`, `completeUpload`, `openDownload`, `deleteObject` y, para pruebas, inspección del adaptador falso;
- adaptador local limitado a directorio configurado de desarrollo;
- adaptador S3-compatible parametrizado, sin escoger proveedor;
- adaptador falso/en memoria para tests.

Política inicial recomendada, configurable:

- máximo general: 25 MiB por archivo;
- MIME permitidos: PDF, PNG, JPEG, texto plano, CSV, DOCX y XLSX;
- extensiones permitidas coherentes: `.pdf`, `.png`, `.jpg`, `.jpeg`, `.txt`, `.csv`, `.docx`, `.xlsx`;
- detectar MIME real cuando sea posible; no confiar solo en extensión/header;
- SHA-256 en `checksum_sha256`;
- propietario en `uploaded_by_user_id` y organización obligatoria según SQL;
- visibilidad derivada de `classification` y del padre autorizado;
- estados actuales: `pending_upload`, `pending_scan`, `active`, `quarantined`, `deleted`;
- cuarentena impide descarga;
- borrado lógico coordina `status='deleted'` y `deleted_at`;
- descarga mediante stream/ruta local protegida o URL temporal S3-compatible, siempre después de revalidar permisos.

La lista y tamaño deben confirmarse antes de producción y pueden reducirse por tipo de padre.

### Ticket ampliado

El SQL actual soporta organización, solicitante, responsable individual opcional, proyecto opcional, prioridades, estados, resolución, comentarios y archivos. Futuras migraciones propuestas, no ejecutadas:

- `ticket_team_assignments` o `assigned_team_id` cuando exista un modelo de equipos;
- `service_id` opcional, con FK a `services`;
- catálogo `ticket_categories` y `category_id` opcional hasta clasificación;
- `ticket_transition_events` para historial específico;
- permisos de confirmar, rechazar y reabrir;
- historial de prioridad descrito arriba.

## Limitaciones del avance derivado

La fórmula inicial trata todas las tareas válidas con el mismo peso, no refleja esfuerzo, complejidad, hitos, entregables ni tareas bloqueadas. Una tarea pequeña vale lo mismo que una grande. También puede cambiar bruscamente al crear/cancelar tareas. Es aceptable para el MVP si la API identifica el valor como estimación operativa y mantiene métricas de hitos/entregables separadas.

