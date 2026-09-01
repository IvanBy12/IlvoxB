# Migraciones operativas para Azure PostgreSQL

Requisitos: PostgreSQL 18.x, `DATABASE_URL` apuntando al schema `public` y una copia de seguridad verificada cuando la base ya exista. El operador valida la baseline, la cadena y hashes 0000–0014, el catálogo, RBAC y la historia `drizzle.__drizzle_migrations`. Nunca usa `drizzle-kit push`.

## Base Azure nueva y vacía

La confirmación incluye el nombre exacto de la base para impedir un bootstrap accidental:

```powershell
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@SERVER.postgres.database.azure.com:5432/ilvox_prod?sslmode=require'
npm run db:migrate -- --bootstrap-empty=ilvox_prod
```

El operador exige cero relaciones en `public`, aplica la baseline autoritativa, comprueba su estado, registra `0000` y deja que el migrador oficial de Drizzle aplique `0001`–`0014`.

## Base existente

```powershell
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@SERVER.postgres.database.azure.com:5432/ilvox_prod?sslmode=require'
npm run db:migrate
```

La historia debe ser un prefijo exacto del journal, incluidos hashes y timestamps, y el catálogo/RBAC deben coincidir con su snapshot. Solo se aplican migraciones pendientes. Una segunda ejecución finaliza con `applied: []`.

Una base no vacía sin historia solo se reconoce automáticamente si coincide exactamente con la baseline 0000. Cualquier estado parcial, hash distinto o catálogo desconocido aborta antes de migrar.

## Gate previo

```powershell
npm ci
npm run check
npm run db:check
npm run audit:parity
npm run audit:rbac
npm run audit:constraint-names
```

En una estación local con PostgreSQL 18 configurado también puede repetirse el ensayo aislado, que crea y elimina una base temporal:

```powershell
npm run db:validate:migrate
```
