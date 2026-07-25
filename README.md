# ILVOX Backend

Backend Node.js, TypeScript, Fastify, Drizzle ORM y PostgreSQL.

Fase 5 incluye proyectos ligados a organizaciones, miembros con revocacion
historica, hitos, entregables opcionalmente ligados a hitos y tareas de proyecto
o standalone internas.

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
npm.cmd run test:database -- --database-url
npm.cmd run smoke:phase5:operational
npm.cmd run openapi:phase5
```

La API esta en `docs/openapi.json` (0.5.1, 44 operaciones). El cierre operativo
y sus evidencias estan en `docs/phase-5-operational-deployment.md`.

La baseline exacta esta en `drizzle/baseline/`. No use `drizzle-kit push`.
La base local `GestionIlvox.public` reconoce 0000-0007; 0000-0005 fueron
reconocidas sin reaplicar su DDL y el migrador oficial aplico solo 0006-0007.
Para auditar o repetir el procedimiento en otro entorno, use
`npm run db:operate:phase5 -- inspect` y siga
`docs/drizzle-history-recognition.md`.

Fase 5 esta cerrada con la condicion de completar `npm audit` antes de
despliegue publico. Fase 6 no fue iniciada.
