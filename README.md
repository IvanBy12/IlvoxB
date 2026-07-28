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

## Validacion

```powershell
npm.cmd run check
npm.cmd run db:check
npm.cmd run audit:sql -- drizzle\baseline\0000_ilvox_complete_reconstructed.sql
npm.cmd run audit:rbac -- drizzle\baseline\0000_ilvox_complete_reconstructed.sql
npm.cmd run audit:parity -- drizzle\baseline\0000_ilvox_complete_reconstructed.sql
npm.cmd run audit:constraint-names
npm.cmd run db:validate:runtime -- --database-url
npm.cmd run db:validate:phase3 -- --database-url
npm.cmd run db:validate:phase45 -- --database-url
npm.cmd run db:validate:phase5-closure -- --database-url
npm.cmd run db:validate:phase6 -- --database-url
npm.cmd run test:database -- --database-url
npm.cmd run smoke:phase5:operational
npm.cmd run openapi:phase5
npm.cmd run openapi:phase6
```

La API esta en `docs/openapi.json` (0.6.0, 55 operaciones). La implementacion
de tickets se documenta en `docs/phase-6-tickets-implementation.md`.

La baseline exacta esta en `drizzle/baseline/`. No use `drizzle-kit push`.
La base local `GestionIlvox.public` reconoce 0000-0007; 0000-0005 fueron
reconocidas sin reaplicar su DDL y el migrador oficial aplico solo 0006-0007.
Para auditar o repetir el procedimiento en otro entorno, use
`npm run db:operate:phase5 -- inspect` y siga
`docs/drizzle-history-recognition.md`.

La migracion 0008 de Fase 6 esta versionada pero no se aplica automaticamente a
`GestionIlvox.public`. `npm audit` continua como gate de despliegue publico.
