# Resultados de pruebas de Fase 5

Fecha: 23 de julio de 2026.

## Suites dirigidas

- Máquinas de proyectos y tareas: transiciones permitidas/prohibidas, terminales, motivos y
  privilegio.
- Auditoría: redacción de contacto y descripciones.
- HTTP: creación autorizada, cuerpos cerrados, campos protegidos, standalone cliente y
  rechazo de `ticketId`.
- PostgreSQL: organización obligatoria, checks de contexto, scope en lista/detalle/conteo,
  alta duplicada de miembro, transiciones concurrentes, actualización concurrente de hito,
  asignación concurrente, proyecto terminal y rollback de auditoría.

## Resultado real

| Comando | Resultado |
| --- | --- |
| `npm run check` | Aprobado: TypeScript, ESLint, 83 pruebas; 29 PostgreSQL omitidas; auditor 4/4; build |
| `npm run test:database -- --database-url` | Aprobado: 112/112, 19 archivos, PostgreSQL 18.4 |
| `npm run db:check` | Aprobado |
| `db:validate:phase3 -- --database-url` | Aprobado; `public` sin cambios y cleanup |
| `db:validate:phase45 -- --database-url` | Aprobado; rollback y cleanup |
| `db:validate:runtime -- --database-url` | Aprobado; baseline exacta y cleanup |
| `audit:sql` | Aprobado: estado físico 19/204/43/57/15/54 |
| `audit:rbac` | Aprobado: 11/37/159, sin duplicados, huérfanos ni leaks |
| `audit:parity` | Aprobado; solo adiciones históricas esperadas de Fase 3 |
| `audit:constraint-names` | Aprobado: 57/43/15, cero drift/schemas residuales |
| `smoke:phase45:public` | Aprobado; conversión, servicios, rollback y cleanup |
| OpenAPI | JSON válido, 0.5.0, 43 operaciones; 23 de Fase 5 |

Las 8 pruebas PostgreSQL específicas de Fase 5 aprobaron y sus schemas temporales fueron
eliminados. Las regresiones no repitieron Clerk real.

`npm audit --omit=dev` y `npm audit` intentaron consultar advisories, pero el sandbox bloqueó
la red/log externo. La ampliación fue rechazada por riesgo de divulgar metadatos de
dependencias. Resultado **inconcluso**: no se afirma cero vulnerabilidades y no se ejecutó
`audit fix`.
