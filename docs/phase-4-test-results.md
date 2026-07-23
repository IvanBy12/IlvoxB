# Resultados de pruebas de Fase 4

> Resultado histórico. La ejecución vigente y ampliada está en
> `phase-4-5-test-results.md`.

Fecha: 23 de julio de 2026.

## Resultado final

| Validación | Resultado |
| --- | --- |
| `npm.cmd run typecheck` | Aprobado |
| `npm.cmd run lint` | Aprobado |
| `npm.cmd test` | 59 aprobadas, 15 PostgreSQL omitidas sin `TEST_DATABASE_URL` |
| `npm.cmd run build` | Aprobado |
| `npm.cmd run check` | Aprobado |
| `npm.cmd run db:check` | Aprobado |
| `npm.cmd run test:database` | No ejecutó: `TEST_DATABASE_URL_MISSING` |
| `node scripts/test-with-database.mjs --database-url` | 74/74 aprobadas |
| `audit:sql` sobre baseline consolidada | Aprobado; 19 tablas, sin duplicados/referencias desconocidas |
| `audit:rbac` sobre baseline consolidada | Aprobado; 11 roles, 23 permisos, 142 asociaciones |
| `audit:parity` sobre baseline consolidada | Aprobado; paridad esperada con adiciones de Fase 3 |
| `docs/openapi.json` | JSON válido; 18 operaciones implementadas |
| `git diff --check` | Aprobado; solo avisos de normalización LF/CRLF |

El runner PostgreSQL usa schemas temporales, aplica baseline y migraciones 0001–0003 y
elimina los schemas al finalizar. No se aplicaron migraciones al schema operativo.

## Cobertura añadida

- estados y transiciones exactas, rechazo/reapertura con motivo y terminalidad;
- catálogo público activo/visible;
- captación válida, campos protegidos y repetición legítima por correo;
- permisos HTTP y registro final de rutas;
- scopes organizacionales, incluido fail-closed sin `organizations.access_all`;
- conversión concurrente, una sola organización e idempotencia;
- membresía local activa/revocada sin borrar identidad;
- auditoría pública sin correo ni mensaje.

Las 74 pruebas PostgreSQL incluyen regresiones automatizadas de autenticación, `/me`,
webhooks, idempotencia, scopes, privilegios, archivos y readiness de Fase 3. No se repitieron
eventos reales de Clerk.

## Auditoría de dependencias

`npm.cmd audit --omit=dev` y `npm.cmd audit` se intentaron. El sandbox no pudo acceder al
endpoint del registro npm y la elevación fue rechazada porque el inventario de dependencias
se enviaría a un servicio externo sin una aprobación de exportación separada. Resultado:
**inconcluso**, no “cero vulnerabilidades”. No se ejecutó `audit fix --force`.

## Integridad del alcance

- sin cambios Drizzle/schema ni nuevas migraciones;
- sin `drizzle-kit push`;
- sin commit o push;
- sin secretos reales detectados; coincidencias del escaneo fueron placeholders de
  `.env.example` y cadenas deliberadas de pruebas de redacción;
- no se escribió en IlvoxF. Ese repositorio reporta un `package-lock.json` modificado que no
  fue creado ni alterado durante esta ejecución.
