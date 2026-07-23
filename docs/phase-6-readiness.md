# Readiness para Fase 6

Estado: Fase 5 aprobada con condiciones; Fase 6 no iniciada.

La base para una fase posterior queda preparada con:

- proyectos tenant-bound y scopes SQL;
- membresía de proyecto y roles físicos;
- hitos y entregables de proyecto;
- tareas de proyecto y standalone internas;
- máquinas de estado, auditoría y concurrencia;
- OpenAPI 0.5.0 y pruebas PostgreSQL.

Condiciones antes de aprobar Fase 6:

1. resolver o aceptar explícitamente la revisión npm antes del despliegue público;
2. decidir si se autorizan las migraciones propuestas para revocación de miembros y relación
   entregable–hito;
3. diseñar tickets, comentarios y archivos como agregados completos, sin reutilizar
   `organization_id=NULL` como scope;
4. no conectar frontend hasta una decisión separada.

Este documento no autoriza implementación ni migraciones de Fase 6.
