# Implementación de Fase 4

Fecha de actualización: 23 de julio de 2026.

Fase 4 implementó catálogo, leads, organizaciones opcionales, membresías, auditoría y scopes.
Fase 4.5 ajustó el producto para que el MVP no dependa de una organización.

## Implementado

- catálogo público activo+visible;
- lectura y mutación administrativa con `services.read`/`services.manage`;
- captación y administración interna de leads;
- máquina de estados;
- conversión `standalone|create_organization|reuse_organization`;
- organizaciones y membresías como módulo opcional;
- auditoría transaccional, scopes SQL, paginación y OpenAPI.

No se implementaron contactos, invitaciones, edición organizacional cliente, proyectos,
tickets o archivos completos.

## Migraciones Fase 4.5

- 0004 cambia únicamente `chk_leads_conversion`.
- 0005 agrega `services.manage` a super_admin y admin.
- ambas tienen rollback y fueron validadas en schema temporal;
- ninguna fue aplicada sobre `public`.

Documentos de detalle:

- `phase-4-5-optional-organizations.md`;
- `lead-standalone-conversion.md`;
- `services-management.md`;
- `phase-4-5-test-results.md`.
