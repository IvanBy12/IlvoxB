# Revisión de seguridad de Fase 5

## Controles aprobados

- autenticación Clerk y perfil local activo mediante el middleware existente;
- permiso efectivo y scope producido por `AuthorizationService`;
- scope SQL previo a lectura, conteo, búsqueda o paginación;
- body TypeBox cerrado y campos contextuales protegidos;
- contexto de organización derivado del proyecto;
- standalone estrictamente interno, nunca público ni organizacional;
- auditoría transaccional sin emails, teléfonos ni descripciones completas;
- locks, estado observado, `expectedUpdatedAt`, rollback y 409;
- sin borrado físico, URLs, almacenamiento, metadata Clerk ni identidad por email.

## Riesgos residuales

1. `projects.manage` es un permiso amplio que cubre proyecto, miembros, hitos y entregables;
   separar capacidades requeriría una migración RBAC autorizada.
2. Revocar miembros preservando historia no es posible con el esquema actual; la ruta no se
   expone.
3. Entregables no pueden ligarse a hitos con integridad de proyecto; `milestoneId` se rechaza.
4. Hitos y entregables validan estados físicos, pero no tienen historial especializado; usan
   `audit_events`.
5. La revisión de advisories npm depende de acceso al registro y debe quedar resuelta antes
   de despliegue público si el entorno vuelve a bloquearla.

## Fuera de alcance confirmado

Tickets, comentarios, archivos, SLA, notificaciones, contactos, invitaciones, organizaciones
Clerk, proyectos standalone y Fase 6.
