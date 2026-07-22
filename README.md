# ILVOX Backend

Backend de ILVOX construido con Node.js, TypeScript, Fastify, Drizzle ORM y PostgreSQL.

La Fase 3 incorpora autenticación oficial Clerk, perfil local, `ActorContext`, autorización contextual, scopes SQL, `/me`, webhooks idempotentes y audiencia de archivos. Los módulos funcionales completos continúan fuera de alcance.

## Requisitos

- Node.js 22 o superior.
- PostgreSQL 16 para validar la compatibilidad objetivo.

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
npm run db:validate:phase3 -- --database-url
npm run test:database -- --database-url
```

La baseline exacta está en `drizzle/baseline/`. Antes de usar migraciones, siga
`docs/database-parity.md`: la migración `0000` es una guarda de seguridad y falla
deliberadamente mientras el entorno no haya reconocido la baseline.

Las migraciones de Fase 3 solo deben validarse en esquemas temporales; no use `drizzle-kit push`. PostgreSQL 16 continúa pendiente antes de producción. La documentación está en [`docs/`](./docs/).
