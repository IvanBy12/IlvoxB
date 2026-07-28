# Fase 7.2 — Resultados del módulo público

Fecha: 27 de julio de 2026

## Cobertura

- Frontend: 17 pruebas sobre cliente base, servicios, detalle, categorías,
  sources, payload, opcionales, campos prohibidos, POST único, 429, validación,
  lock y contrato accesible.
- Backend focal: 16/16 en `phase4-http` y 3/3 CORS; cubren listado, filtros,
  detalle, 201, campos protegidos, servicio inexistente, body 413 y rate 429.

## Smoke real

1. Catálogo PostgreSQL inicialmente vacío mostrado con UX real.
2. Un servicio publicado temporal apareció y abrió su detalle.
3. Contacto, diagnóstico y cotización produjeron 201.
4. PostgreSQL confirmó 3 leads, sources 1/1/1 y el mismo serviceId.
5. Usuarios/organizaciones/proyectos permanecieron 5/0/0.
6. Se comprobaron 400, 404 y 429.
7. El 429 visual conservó datos, mostró cuenta regresiva y deshabilitó submit.
8. Se eliminaron 21 leads de prueba y 1 servicio; residuo 0/0.
9. El catálogo volvió al estado vacío y el detalle temporal devolvió 404.

## Responsive y accesibilidad

Se evaluaron `/servicios`, `/contacto`, `/diagnostico`, `/cotizacion` y detalle
en 360, 768, 1024 y 1440 px: 20/20 sin overflow horizontal ni controles
recortados. En 360 px, un submit vacío enfocó `fullName`, anunció 3 errores y
conservó input modes `email` y `tel`.

## Seguridad

Las llamadas públicas no enviaron Authorization en tests. No se persisten
tokens ni leads; no hay HTML inseguro ni retry automático del POST. El payload
no contiene campos internos. RequestId se conserva para soporte sin mostrar
detalles técnicos.

## Gate integral final

- Frontend: typecheck, 17/17 tests y build de producción pasaron. Vite mantiene
  un warning no bloqueante por un chunk principal de 801,33 kB.
- Backend: typecheck, lint, 107/107 tests, 6/6 pruebas de auditoría de
  constraints y build pasaron.
- Runtime: `live` y `ready` 200; `/me` sin bearer 401 `UNAUTHENTICATED`;
  catálogo público 200 con 0 elementos después de la limpieza.
- CORS: origen canónico exacto, origen `localhost` no autorizado y exposición
  de `Retry-After` y `X-Request-Id`.
- Bundle: cero coincidencias de patrones de secretos en `dist`.

Los advisories continúan como revisión separada: 1 moderado y 2 altos, sin
ejecutar fixes.
