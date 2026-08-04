# Fase 7.5A — resultados de pruebas

Fecha: 4 de agosto de 2026.

## Gate frontend

Comando requerido: `npm.cmd run check` en IlvoxF.

- TypeScript: aprobado.
- Pruebas Node: 47 aprobadas, 0 fallidas.
- Build Vite: aprobado; 2.310 módulos transformados.
- Nota operacional: el primer build dentro del sandbox no pudo leer `vite.config.ts`; el
  mismo build se repitió con acceso autorizado y terminó correctamente.

Las regresiones nuevas verifican paths, query params, token fresco por solicitud, bodies de
POST/PATCH, revocación, ausencia de llamadas Clerk, UUID neutral, 409 con `requestId`, locks
de submit y ausencia de `AppStore`/seed en las tres pantallas migradas.

## Gate backend

Comando requerido: `npm.cmd run check` en IlvoxB.

- Typecheck: aprobado.
- ESLint: aprobado.
- Vitest: 120 aprobadas, 47 omitidas por requisitos de DB; 0 fallidas.
- Auditoría de constraints: 6 aprobadas.
- Build TypeScript: aprobado.

Las pruebas backend existentes cubren autorización, scopes organizacionales, repositorios,
catálogo público y contratos HTTP. No fue necesario cambiar rutas, schemas u OpenAPI.

## Smoke HTTP/PostgreSQL real

Comando: `npm.cmd run smoke:phase75a:internal`.

El smoke crea identidades, servicios, dos organizaciones y memberships controladas con el
prefijo `PHASE75A_SMOKE_`, usa una autenticación inyectada solo dentro de la app de prueba y
siempre limpia en `finally`.

Resultados:

| Área | Evidencia |
| --- | --- |
| Servicios | create 201, list 200, detail 200, duplicado 409, sin permiso 403, ausente 404 |
| Visibilidad pública | solo activo + público; oculto o inactivo devuelve 404; reactivado vuelve a 200 |
| Organizaciones | dos altas 201, búsqueda/listado 200, paginación total 2, detalle 200, edición 200 |
| Errores organización | duplicado 409, sin permiso 403, ausente 404 |
| Memberships | listado 200, edición 200, revocación 200; acceso revocado 403 |
| Aislamiento | organización propia 200; organización ajena 403 antes de repositorio |
| Presentación cross-tenant | el 403/404 de detalle se muestra como “Recurso no disponible” |
| Limpieza | `residualFixtures: 0` |

No se persistieron tokens, no se llamó Clerk, no se usaron usuarios seed y no quedaron
fixtures. Los dos intentos preliminares fallidos del smoke también terminaron con residuo
cero antes de corregir el orden de las aserciones.

## Runtime

Probes contra `http://127.0.0.1:3001`:

- `/health/live` → 200;
- `/health/ready` → 200;
- `/me` sin token → 401;
- `/api/v1/services` → 200.

## Regresiones y alcance

El gate frontend conserva las pruebas de invitación, `/me`, portal, servicios y formularios
públicos, logout, cache y ausencia de signup/OAuth. El gate backend conserva todas las
regresiones de fases previas. No se inició 7.5B y no se ejecutaron migraciones ni operaciones
Git de escritura.
