# Despliegue local de Fase 4.5

Fecha: 23 de julio de 2026.  
Entorno autorizado: `GestionIlvox.public`, PostgreSQL 18.4 local.  
Resultado: **aprobado con condición operativa de auditoría npm**.

## Preflight

- Base: `GestionIlvox`.
- Esquema activo: `public`.
- Usuario PostgreSQL: `postgres`.
- Servidor: `127.0.0.1:5432`.
- Versión: PostgreSQL 18.4, 64 bits.
- `search_path`: `"$user", public`; `current_schema()=public`.
- `NODE_ENV=development`; el servidor es local y no está en recovery.
- Sin transacciones `idle in transaction`, sesiones esperando locks ni locks pendientes sobre
  `leads`, `roles`, `permissions` o `role_permissions`.
- Sin schemas temporales residuales.
- 0001–0003 completos: 13 permisos de Fase 3, cero grants legacy prohibidos, columna/checks/índice
  de audiencia y las cuatro columnas/check de idempotencia Clerk presentes.
- 0004 no estaba aplicada: `chk_leads_conversion` todavía exigía organización para `converted`.
- 0005 no estaba aplicada: cero permisos y cero grants `services.manage`.

| Estado previo | Conteo |
| --- | ---: |
| Tablas / columnas | 19 / 204 |
| FK / CHECK / UNIQUE | 43 / 57 / 15 |
| Índices explícitos | 54 |
| Roles / permisos / asociaciones distintas | 11 / 36 / 157 |

No se detectó drift y se autorizó continuar.

## Backup

- Archivo: `GestionIlvox-pre-phase45-20260723-150003.dump`.
- Ubicación local: `tmp/phase45-backups/`.
- Creación: `2026-07-23T20:00:03.4408452Z` (`15:00:03` America/Bogota).
- Tamaño: 87.332 bytes.
- Entradas: 173.
- SHA-256: `D3702D857425AEACB5DB3D713CA321DA153511F2F81D4E543154FA6A68558809`.
- Formato: PostgreSQL custom archive, compresión 9.
- Herramienta: `pg_dump (PostgreSQL) 18.4`.
- Base respaldada: `GestionIlvox`.

`pg_restore --list` aprobó y `pg_restore --file=NUL` recorrió/descomprimió el archive completo.
El contenido incluye schema, datos de roles/permisos/asociaciones, leads, servicios, constraints,
índices y los artefactos físicos de 0001–0003. No se expusieron credenciales ni URLs de conexión.

## Migraciones aplicadas

Se ejecutaron únicamente, en orden:

1. `0004_phase4-5-lead-standalone-conversion.sql`: `BEGIN`, preflight, reemplazo de
   `chk_leads_conversion`, postflight y `COMMIT` aprobados. El nombre y el total de checks se
   conservaron.
2. `0005_phase4-5-services-manage.sql`: `BEGIN`, preflight 11/36/157, inserción de un permiso y
   dos grants, postflight 37/159 y `COMMIT` aprobados.

No se ejecutaron rollbacks sobre `public`, DDL manual equivalente, otras migraciones,
`drizzle-kit push`, commit ni push.

## Estado físico posterior

| Estado posterior | Conteo |
| --- | ---: |
| Tablas / columnas | 19 / 204 |
| FK / CHECK / UNIQUE | 43 / 57 / 15 |
| Índices explícitos | 54 |
| Roles / permisos / asociaciones distintas | 11 / 37 / 159 |
| Asociaciones duplicadas / huérfanas | 0 / 0 |

`services.manage` tiene exactamente:

- `global:admin`;
- `global:super_admin`.

No existe en roles cliente ni adicionales. Los cinco permisos sensibles
`permissions.manage`, `roles.assign_super_admin`, `security.manage`, `system.configure` y
`organizations.access_all` conservan cinco grants, todos en `global:super_admin`, sin leaks.

El nuevo check de leads fue probado dentro de una transacción revertida:

- acepta `converted` con `converted_at` y organización nula;
- acepta `converted` con `converted_at` y organización válida;
- rechaza `converted` sin `converted_at`;
- rechaza estados no convertidos con campos de conversión;
- la FK continúa rechazando una organización inexistente.

## Auditor histórico

`audit:constraint-names` ya deriva los nombres de CHECK, FK y UNIQUE desde `drizzle-kit export`,
compara faltantes e inesperados y detecta índices físicos duplicados y schemas temporales.
Clasifica `chk_leads_conversion` como `pre_phase45` o `phase45`, por lo que entiende que 0004
reemplaza un check sin aumentar el total. Sus cuatro pruebas Node automatizadas aprobaron antes
y después de 0004. En el estado final reportó 57/43/15, cero drift y fase `phase45`.

## Backend y smoke tests reales

El backend compilado fue reiniciado completamente con la misma configuración local:

- `GET /health/live`: 200;
- `GET /health/ready`: 200, check `database=up`;
- pool activo y `GET /api/v1/services`: 200 bajo `/api/v1`;
- sin errores de schema ni warnings críticos de migración.

El runner `smoke:phase45:public` usó HTTP Fastify y PostgreSQL `public` reales, con identidad
local inyectada y Clerk deshabilitado para el runner:

- standalone: 200, organización nula, `converted_at` informado, sin organización/membership/
  usuario adicional;
- reintento idéntico: 200 e `idempotent=true`;
- cambio de modalidad: 409, sin segundo efecto;
- dos solicitudes concurrentes: 200/200, resultados efectivo/idempotente;
- una sola auditoría funcional por conversión, sin email ni nombre del lead;
- `create_organization`: 200, reintento y concurrencia idempotentes;
- mismo nombre en dos leads: dos organizaciones distintas, sin merge automático;
- `reuse_organization`: 200 y reintento idempotente con scope `super_admin`;
- scope cliente: 403;
- fallo tardío de auditoría: rollback de organización y lead aprobado preservado;
- cero contactos e identidades/sesiones Clerk.

Servicios:

- creación: 201; visible en lista administrativa y catálogo público;
- oculto: desaparece de detalle/lista pública y permanece en administración;
- republicado y luego inactivo: vuelve a desaparecer de público y permanece en administración;
- sin permiso: 403; actor cliente: 403; duplicado: 409;
- body inválido: 400; campo desconocido: 400; DELETE inexistente: 404;
- auditoría con cuatro eventos y sin descripción completa.

El smoke detectó y corrigió una validación que eliminaba campos desconocidos silenciosamente.
Fastify usa ahora `removeAdditional=false` y los schemas de servicios declaran
`additionalProperties=false`; la regresión HTTP automatizada aprobó.

## Automatización y OpenAPI

| Comando / suite | Resultado |
| --- | --- |
| `npm run check` | Aprobado: TypeScript, ESLint, build, 65 pruebas; 21 PostgreSQL omitidas sin variable |
| `test:constraint-audit` | 4/4 |
| `test:database -- --database-url` | 86/86 |
| HTTP de Fase 4 dirigido | 11/11 |
| `db:check` | Aprobado |
| `db:validate:phase3 -- --database-url` | Aprobado; cleanup |
| `db:validate:phase45 -- --database-url` | Aprobado; rollback temporal y cleanup |
| `db:validate:runtime -- --database-url` | Aprobado; baseline exacta y cleanup |
| `audit:sql` | Baseline aprobada y catálogo físico vigente 19/204/43/57/15/54 |
| `audit:rbac` | Baseline 11/23/142 y estado físico vigente 11/37/159, sin leaks |
| `audit:parity` | Aprobado con adiciones esperadas de Fase 3 |
| `audit:constraint-names` físico | Aprobado; 57/43/15, fase 4.5 |
| OpenAPI | JSON válido, versión 0.4.5, exactamente 20 operaciones |

OpenAPI contiene POST/PATCH de administración de servicios, los tres modos de conversión y
sus permisos; no contiene contactos, rutas de Fase 5 ni endpoints no implementados.

Los comandos literales `npm audit --omit=dev` y `npm audit` intentaron consultar el endpoint de
advisories y fallaron por acceso de red. La ampliación de red fue rechazada por la política del
entorno para no divulgar metadatos de dependencias. El resultado es **inconcluso**; no se afirma
cero vulnerabilidades y no se ejecutó `audit fix --force`.

## Limpieza y decisión

Tras cada intento y tras el smoke aprobado quedaron en cero los leads, servicios,
organizaciones, memberships, usuarios locales y auditorías con el tag de prueba. También
quedaron cero schemas temporales, contactos, usuarios Clerk y sesiones Clerk.

No se modificó ni conectó `IlvoxF`. No se inició Fase 5.

Decisión: **Preparado con condiciones para Fase 5**. La condición pendiente es completar
`npm audit` desde un entorno autorizado con acceso al registro antes de un despliegue público.
Fase 5 debe mantener proyectos ligados a organización y limitar standalone a tareas internas;
no puede volver nullable proyectos, tickets o archivos sin el rediseño contextual aprobado.
