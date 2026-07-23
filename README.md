# ILVOX Backend

Backend de ILVOX construido con Node.js, TypeScript, Fastify, Drizzle ORM y PostgreSQL.

Las Fases 3–3.5 incorporan Clerk, perfil local, `ActorContext`, autorización contextual,
scopes SQL, `/me`, webhooks idempotentes y audiencia de archivos. Fases 4–4.5 añaden
catálogo administrable, leads, conversión standalone y organizaciones opcionales. Fase 5
añade proyectos tenant-bound, miembros, hitos, entregables y tareas de proyecto o standalone
internas usando `/api/v1`.

## Requisitos

- Node.js 22 o superior.
- PostgreSQL 18.x; la versión runtime validada oficialmente es PostgreSQL 18.4.

## Inicio local

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

## Validación

```powershell
npm run check
npm run audit:sql -- C:\ruta\ilvox_complete_reconstructed.sql
npm run audit:rbac -- C:\ruta\ilvox_complete_reconstructed.sql
npm run audit:parity -- C:\ruta\ilvox_complete_reconstructed.sql
npm run audit:constraint-names
npm run db:validate:phase3 -- --database-url
npm run db:validate:phase45 -- --database-url
npm run test:database -- --database-url
npm run smoke:phase45:public
npm run openapi:phase5
```

La API está descrita en `docs/phase-5-api.md` y `docs/openapi.json` (0.5.0, 43 operaciones).
Las organizaciones son opcionales para el MVP general, pero los proyectos continúan ligados
a una organización. Las tareas standalone son privadas e internas. No existen contactos
empresariales ni invitaciones en este alcance.

La baseline exacta está en `drizzle/baseline/`. Antes de usar migraciones, siga
`docs/database-parity.md`: la migración `0000` es una guarda de seguridad y falla
deliberadamente mientras el entorno no haya reconocido la baseline.

Las migraciones deben validarse en esquemas temporales; no use `drizzle-kit push`. Las
migraciones 0004–0005 están versionadas, aplicadas sobre `GestionIlvox.public` y validadas con
smoke tests reales. El resultado de despliegue está en
`docs/phase-4-5-deployment-results.md`.

Fase 5 no añade migraciones. Las propuestas no aplicadas para revocación histórica de
miembros y relación entregable–hito están en `docs/phase-5-implementation.md`.

PostgreSQL 16 no fue probado ni está soportado oficialmente, pero no es un gate. Cualquier
versión fuera de PostgreSQL 18.x requiere revalidación completa. La auditoría npm del cierre
local quedó inconclusa por falta de acceso autorizado al registro y debe repetirse antes del
despliegue público.
