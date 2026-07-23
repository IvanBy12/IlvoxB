# Política y comparación de versiones PostgreSQL

Fecha: 22 de julio de 2026.
Estado: **PostgreSQL 18.x oficial; PostgreSQL 18.4 validado**.

| Característica | PostgreSQL 18.4 | PostgreSQL 16 | Consecuencia vigente |
| --- | --- | --- | --- |
| Soporte oficial | Sí, evidencia runtime oficial | No | Staging y producción permanecen en 18.x |
| Aplicación de baseline | Aprobada en esquema aislado | No ejecutada | 16 es compatibilidad desconocida, no gate |
| Tiempo de baseline | 230.97 ms en la validación registrada | No medido | El tiempo es evidencia operativa, no promesa |
| Catálogo baseline | 19 tablas, 199 columnas, 43 FK, 55 CHECK, 15 UNIQUE, 53 índices explícitos | No inspeccionado | Catálogo 18.4 aprobado |
| Identity/generada | 1/1 aprobadas | No probadas | Evidencia oficial en 18.4 |
| Índices parciales/expresión | Aprobados | No inspeccionados | Evidencia oficial en 18.4 |
| Migraciones Fase 3 | `0001`–`0003` aprobadas | No ejecutadas | Evidencia oficial en 18.4 |
| Catálogo final | 19 tablas, 204 columnas, 43 FK, 57 CHECK, 15 UNIQUE, 54 índices explícitos | No disponible | Evidencia oficial en 18.4 |
| RBAC final | 11 roles, 36 permisos, 157 asociaciones; cero fugas | No disponible | Evidencia oficial en 18.4 |
| Advisory locks/transacciones | Aprobados | No probados | Evidencia oficial en 18.4 |
| Rollbacks | Estado 199/55/53 y 23/142 restaurado | No ejecutados | Evidencia oficial en 18.4 |
| Suite con DB | 44/44 aprobadas | No ejecutada | Evidencia oficial en 18.4 |

No se afirma compatibilidad con PostgreSQL 16. Su ausencia no bloquea Fase 3.5, Fase 4 ni una producción desplegada dentro de PostgreSQL 18.x.

Si un proveedor ofrece una versión diferente de 18.x, debe repetirse antes del despliegue la validación completa de baseline, catálogo, migraciones, rollbacks y pruebas. La sintaxis aparentemente compartida o una diferencia menor de rendimiento no sustituyen esa validación específica. Véase `postgresql-version-policy.md`.
