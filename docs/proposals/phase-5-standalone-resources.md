# Propuesta — recursos standalone de Fase 5

Estado: diseño únicamente. No se modificaron proyectos, tickets, tareas ni archivos.

## Proyectos

Para permitir `projects.organization_id=NULL` se debe:

- conservar `projects.id` como identidad global;
- cambiar hijos a FK simple por `project_id`;
- derivar organización desde el proyecto o validar igualdad con constraint trigger usando
  `IS NOT DISTINCT FROM`;
- definir miembros internos por roles globales/proyecto sin convertir `NULL` en tenant;
- revisar uniques, índices, hitos, entregables, tareas, archivos y auditoría en conjunto.

## Tickets

Un ticket standalone necesitaría reglas explícitas:

- requester interno; un cliente organizacional no accede por tener membresía;
- proyecto opcional validado por FK simple y contexto compatible;
- comentarios standalone inicialmente solo internos;
- código global actual puede conservarse;
- confirmación/rechazo cliente solo cuando exista organización y requester autorizado;
- archivos y scopes rediseñados antes de habilitarse.

## Archivos

No volver nullable `files.organization_id` todavía. Un diseño futuro necesita un contexto de
seguridad explícito, por ejemplo organización o propietario interno mutuamente exclusivos,
FK simple al padre, validación del contexto derivado, audiencia standalone solo interna,
ownership, descargas temporales, cuarentena y estado activo. Nunca se generarán URLs públicas
permanentes.

## Tareas

El modelo actual ya soporta tareas standalone cuando `project_id`, `ticket_id` y
`organization_id` son `NULL`. Conserva asignado y creador internos obligatorios. No soporta
todavía una tarea vinculada a proyecto/ticket standalone: su check exige organización cuando
hay padre. Ese caso debe migrarse junto con el agregado padre.

## Alcance seguro inicial de Fase 5

Puede comenzar únicamente con proyectos tenant-bound existentes y tareas standalone internas,
si el propietario aprueba ese alcance. Tickets y archivos standalone deben esperar el
rediseño contextual anterior.
