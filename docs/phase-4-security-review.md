# Revisión de seguridad de Fase 4

Fecha: 23 de julio de 2026.

## Controles verificados

- Bodies TypeBox con límites y formatos.
- Captación limitada a 10 solicitudes/minuto además del límite global.
- Estado, responsable y conversión no son campos públicos ni PATCH comerciales.
- Ordenamiento por whitelist.
- Scopes incorporados en consultas y conteos.
- Listados organizacionales globales exigen `organizations.access_all`; se evita que un
  permiso global nominal convierta el listado en acceso transversal implícito.
- 404 uniforme para inexistente/fuera de scope.
- Asignación valida usuario activo con rol global.
- Membresía valida usuario local y rol organizacional permitido.
- Conversión con `FOR UPDATE`, transacción, vínculo persistido e idempotencia.
- Restricción única país+NIT normalizado usada; no existe merge por nombre.
- Auditoría dentro de la misma transacción y con PII redactada.
- No hay tokens, secretos, payloads completos ni URLs públicas de archivos.

## Archivos

Ninguna respuesta de Fase 4 incluye archivos. Si se añade esa relación debe aplicar
simultáneamente scope, audiencia, estado activo, exclusión de cuarentena/no disponibles y
acceso al padre. Esta condición no puede reducirse a `organization_id`.

## Riesgos residuales

- Rate limiting local no sustituye un límite distribuido en despliegues de múltiples réplicas.
- No existe idempotency key persistente para captación o escrituras generales.
- No hay columna de versión optimista; las transiciones comparan estado y la conversión usa
  lock, pero los PATCH comerciales dependen de lock transaccional.
- Contactos y edición de perfil por `client_manager` permanecen fuera del MVP por decisión
  explícita. Las mutaciones del catálogo se habilitan con `services.manage` en 0005.
- Observabilidad/dead-letter de webhooks y operación de almacenamiento siguen siendo trabajo
  operativo futuro documentado, no un bypass de Fase 4.

No se modificó el frontend ni se amplió el alcance a proyectos, tareas, tickets, SLA,
notificaciones, facturación o CMS.
