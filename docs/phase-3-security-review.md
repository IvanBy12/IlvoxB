# Revisión de seguridad — Fase 3

## Controles cerrados

- Clerk autentica; PostgreSQL autoriza. No se confía en correo, metadata, roles ni permisos del frontend.
- Sesión válida no evita la comprobación de perfil local activo.
- Tokens, cookies y firmas se redactan y no entran en `ActorContext`.
- Scopes y organización se aplican dentro de SQL también para count, búsqueda, paginación y agregación.
- Los grants se mantienen ligados a su organización y scope, evitando la unión de privilegios entre membresías.
- Acceso horizontal oculta la existencia de recursos ajenos.
- Operaciones privilegiadas usan permiso explícito, auditoría, transacción, lock e idempotencia.
- Firma webhook sobre bytes originales, hash persistente, colisión detectada, orden temporal, rollback y retry.
- Archivos no son públicos, no guardan binarios en PostgreSQL y la policy bloquea cuarentena/cross-org.
- Migraciones probadas solo en esquemas aleatorios; `public` quedó sin cambios.

## Riesgos pendientes

- Validación runtime en PostgreSQL 16 antes de producción.
- Prueba end-to-end con un tenant Clerk de staging y secretos gestionados externamente.
- El adaptador S3-compatible, análisis antivirus y URLs temporales quedan para una fase posterior.
- No se exponen todavía endpoints completos de roles, tickets ni archivos; se implementaron servicios/policies para evitar ampliar el alcance funcional.
- `npm audit --omit=dev` reporta cero vulnerabilidades. La auditoría completa reporta cuatro moderadas transitivas de `esbuild` bajo `drizzle-kit`; la corrección sugerida es breaking y no se aplicó.
- Falta definir monitoreo/dead-letter operativo para reintentos webhook agotados.

No se detectaron secretos versionados en los archivos creados. `.env` permanece ignorado.
