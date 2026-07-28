# Fase 7.1 — Resultados de validación

Fecha: 27 de julio de 2026  
Node.js: `v26.4.0`  
npm: `11.17.0`

## Frontend IlvoxF

| Validación | Resultado |
| --- | --- |
| Typecheck inicial | Falló solo por `ImportMeta.env` y el import/declaración PNG documentados |
| `npm run typecheck` final | PASS |
| `npm test` | PASS, 7/7 |
| `npm run build` | PASS, Vite 6.3.5, 2.271 módulos |
| Búsqueda de secretos en `dist` | PASS, cero archivos con patrones de secret key/DB/webhook |
| Rutas/código demo de auth | PASS, sin bridge metadata, DemoLogin ni sesión AppStore |

Los siete tests cubren:

1. serialización de arrays en query params;
2. Bearer fresco, ruta raíz `/me` y unwrap de `{ data }`;
3. normalización de error con status/code/requestId/details;
4. timeout separado de aborto externo;
5. permisos `one`/`any`/`all`, fail closed;
6. guard interno/cliente/ambos/ninguno y deep links;
7. limpieza de cache en logout/cambio de usuario y retry acotado.

El primer build dentro del sandbox falló por acceso denegado a
`vite.config.ts`. Repetido con acceso explícito al repositorio solicitado, pasó.
Vite reportó una advertencia no bloqueante: chunk JS minificado de 742,07 kB
(220,17 kB gzip) y asset PNG de 1.429,85 kB. Code splitting/optimización del
logo queda como mejora posterior, fuera de estas fundaciones.

## Backend IlvoxB

`npm run check`: **PASS**.

| Bloque | Resultado |
| --- | --- |
| Typecheck | PASS |
| ESLint | PASS |
| Vitest | 18 archivos pass, 6 skip; 102 tests pass, 47 skip |
| Constraint audit | 6/6 PASS |
| Build TypeScript | PASS |
| CORS nuevo | 3 tests: origen positivo, negativo y preflight Authorization |

## Runtime local

| Prueba | Resultado |
| --- | --- |
| `GET /health/live` | 200 |
| `GET /health/ready` | 200 |
| `GET /me` sin token | 401 `UNAUTHENTICATED`, requestId presente |
| GET desde `http://127.0.0.1:5173` | ACAO correcto y credentials |
| GET desde `http://localhost:5173` | sin ACAO |
| Preflight `/me` con `Authorization` | 204, header permitido |
| CORS env efectivo | coincide con `127.0.0.1:5173` |
| Clerk authorized parties efectivo | coincide con `127.0.0.1:5173` |

El smoke de navegador usó una sesión Clerk real sin inspeccionar ni persistir
su token. Primero confirmó el negativo del perfil local `pending`: autenticación
Clerk correcta, `/me` 403 y “Acceso no habilitado”. Tras habilitar un fixture
PostgreSQL mínimo autorizado, `/me` respondió 200 y la UI resolvió roles,
organización, 17 permisos efectivos y capacidades desde PostgreSQL.

Se verificaron además:

- redirect dual a `/app` y conservación del deep link `/portal/tickets`;
- `PermissionGate` positivo de `tickets.create`; `one`/`any`/`all` y fail closed
  permanecen cubiertos por prueba unitaria;
- error de red real al detener backend, botón Reintentar y recuperación en el
  mismo deep link después de reiniciarlo;
- logout real, `/portal/tickets` protegido y `/me` sin token en 401;
- reautenticación con un nuevo preflight 204 y un nuevo `GET /me` 200;
- navegación sin Documentos, Notificaciones, Auditoría ni RBAC y 404 neutral en
  `/app/auditoria`;
- limpieza final del fixture: 0 organizaciones, 0 memberships, 0 roles
  temporales y 1 perfil restaurado a `pending`.

## Dependencias y auditoría

La instalación de TanStack Query informó 3 advisories existentes/observados
(1 moderado, 2 altos) y tres install scripts pendientes de aprobación. No se
ejecutó `npm audit fix` ni se cambió ninguna otra dependencia.

El intento de consultar el detalle con `npm audit --omit=dev` fue bloqueado por
la política del entorno porque habría enviado el grafo de dependencias al
registro sin autorización específica para exponer ese payload. No se intentó
eludir el bloqueo. El tratamiento de advisories queda pendiente de una revisión
separada autorizada.

## Resultado

Las fundaciones 7.1 pasan los gates locales y el smoke autenticado real. La
Fase 7.1 queda cerrada técnicamente. El paso a Fase 7.2 sigue requiriendo
autorización expresa; esta ejecución no la inició.
