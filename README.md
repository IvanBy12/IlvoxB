# ILVOX Backend

Backend Node.js, TypeScript, Fastify, Drizzle ORM y PostgreSQL.

Fase 6 incluye tickets standalone privados, organizacionales o ligados a
proyectos, con comentarios, scopes SQL, asignacion, prioridad, maquina de
estados, confirmacion y auditoria transaccional. Archivos y Fase 7 no estan
incluidos.

## Requisitos

- Node.js 22 o superior.
- PostgreSQL 18.x; runtime validado: PostgreSQL 18.4.

## Inicio local

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Para recibir eventos Clerk en desarrollo local, instala Clerk CLI, configura en
Clerk el endpoint que muestra el Relay con los eventos `user.created`,
`user.updated` y `user.deleted`, y ejecuta en otra terminal:

```powershell
npm run dev:webhooks
```

El destino local está fijado en `http://127.0.0.1:3001/webhooks/clerk`. La ruta
`/api/webhooks/clerk` no existe. Conserva en `CLERK_WEBHOOK_SIGNING_SECRET` el
Signing Secret del endpoint configurado en Clerk; nunca lo añadas al repositorio.

## Validacion

```powershell
npm.cmd run check
npm.cmd run db:check
npm.cmd run db:migrate
npm.cmd run db:validate:migrate
npm.cmd run audit:sql -- drizzle\baseline\0000_ilvox_complete_reconstructed.sql
npm.cmd run audit:rbac
npm.cmd run audit:parity
npm.cmd run audit:constraint-names
npm.cmd run db:validate:runtime -- --database-url
npm.cmd run db:validate:phase3 -- --database-url
npm.cmd run db:validate:phase45 -- --database-url
npm.cmd run db:validate:phase5-closure -- --database-url
npm.cmd run db:validate:phase6 -- --database-url
npm.cmd run db:operate:phase6 -- inspect
npm.cmd run test:database -- --database-url
npm.cmd run smoke:phase5:operational
npm.cmd run smoke:phase6:operational
npm.cmd run openapi:phase5
npm.cmd run openapi:phase6
```

La API esta en `docs/openapi.json` (0.6.0, 55 operaciones). La implementacion
de tickets se documenta en `docs/phase-6-tickets-implementation.md`.

La baseline exacta esta en `drizzle/baseline/`. No use `drizzle-kit push`.
El operador vigente es `npm run db:migrate`: valida PostgreSQL 18.x, hashes,
historia, catálogo y RBAC antes de aplicar únicamente migraciones pendientes
hasta 0014. Una base vacía requiere la confirmación explícita
`--bootstrap-empty=<nombre-exacto>`. El procedimiento para Azure está en
`docs/azure-database-migrations.md`. Los operadores `db:operate:phase5` y
`db:operate:phase6` se conservan solo como evidencia histórica de esas fases.

La evidencia de backup, hashes, migracion, health, smokes y limpieza esta en
`docs/phase-6-operational-deployment.md`. `npm audit` continua como gate de
despliegue publico externo.
