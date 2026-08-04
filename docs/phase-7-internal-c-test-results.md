# Fase 7.5C — Resultados de pruebas

Fecha: 4 de agosto de 2026.

## Cobertura automatizada

Las pruebas frontend añadidas verifican:

- contratos de listado, detalle, PATCH, transición, asignación y tres conversiones de lead;
- PATCH, asignación/desasignación, prioridad, transición y comentarios de ticket;
- envío explícito de visibilidad interna y defensa portal ante comentario interno;
- state machines visuales adyacentes y requisitos de motivo/resolución;
- ausencia de `AppStore`, seed, Kanban libre y catálogos de usuarios inventados.

## Smoke HTTP/PostgreSQL

`npm run smoke:phase75c:internal` usa fixtures únicas `PHASE75C_SMOKE_` y dos
organizaciones. Cubrió:

- lead público, listado, detalle, edición, asignación, transición, 403, 404 y 409;
- conversión standalone, creación de organización y reutilización;
- tickets standalone, de organización y de proyecto;
- listado, detalle, edición, asignación, desasignación, prioridad y transiciones;
- comentarios `client` e `internal` explícitos;
- cliente sin fuga de comentarios internos y lectura interna autorizada;
- cross-tenant 404, escritura 403, estado inválido y concurrencia 409;
- limpieza final `residualFixtures: 0`.

## Inspección visual

El navegador autenticado validó 360/768/1024/1440 px. Los listados renderizaron estados
vacíos reales, sin overflow de documento. Las rutas de detalle con UUID ausente mostraron
404 neutral y requestId. Tras la corrección del menú de sesión, la medición reportó cero
controles visibles sin nombre accesible. No hubo errores de aplicación en consola; solo la
advertencia esperada por usar claves Clerk de desarrollo.

## Gates finales

- Frontend `npm run check`: typecheck aprobado, 55/55 pruebas y build Vite aprobado.
- Backend `npm run check`: typecheck y lint aprobados; 21 archivos activos aprobados y 6
  omitidos; 120 pruebas activas aprobadas y 47 omitidas; auditoría de constraints 6/6;
  build TypeScript aprobado.
- Runtime en `127.0.0.1:3001`: `/health/live` 200, `/health/ready` 200, `/me` sin
  credenciales 401 y `/api/v1/services` 200.
- Smoke 7.5C: aprobado con `residualFixtures: 0`.

El build frontend conserva una advertencia no bloqueante de chunk superior a 500 kB y una
deprecación de Node en `module.register()`. No se alteró bundling porque no pertenece al
objetivo funcional de 7.5C.

## Decisión

Fase 7.5C queda técnicamente cerrada con todos los gates verdes. La fase no autoriza
Personal ni el inicio de 7.6.
