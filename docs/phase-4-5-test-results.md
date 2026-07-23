# Resultados de pruebas de Fase 4.5

Fecha: 23 de julio de 2026.

La Fase 4.5 fue desplegada y validada sobre `GestionIlvox.public`, PostgreSQL 18.4 local.
El detalle reproducible está en `phase-4-5-deployment-results.md`.

## Automatización

| Suite | Resultado |
| --- | --- |
| TypeScript / ESLint / build | Aprobado |
| Vitest sin DB | 65 aprobadas; 21 PostgreSQL omitidas |
| Auditor de constraints | 4/4 |
| PostgreSQL con `--database-url` | 86/86 |
| HTTP dirigido de Fase 4 | 11/11 |
| Drizzle check | Aprobado |
| Validadores runtime, Fase 3 y Fase 4.5 | Aprobados; cleanup confirmado |
| OpenAPI JSON | Válido; 20 operaciones |

## Resultado persistente

- 0004 y 0005 aplicadas en orden sobre `public`.
- Catálogo: 19 tablas, 204 columnas, 43 FK, 57 checks, 15 unique y 54 índices explícitos.
- RBAC: 11 roles, 37 permisos y 159 asociaciones distintas.
- `services.manage`: exactamente dos grants, cero leaks.
- `chk_leads_conversion`: variante Fase 4.5 validada física y funcionalmente.
- Health live/ready: 200/200; base `up`.

## Cobertura real

- standalone, reintento, conflicto de modalidad y concurrencia;
- cero efectos organizacionales o Clerk en standalone;
- create/reuse, no merge por nombre, reintento, concurrencia y rollback transaccional;
- creación, listado, publicación, ocultamiento y desactivación de servicios;
- 403 sin permiso/cliente, 409 duplicado, 400 body/campo desconocido y DELETE 404;
- auditoría redactada y transaccional;
- regresiones de Fase 3 y 4.

Todos los fixtures y schemas temporales fueron eliminados. `npm audit` quedó inconcluso por
falta de acceso autorizado al registro; no se ejecutó ninguna corrección forzada.
