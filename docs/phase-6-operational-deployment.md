# Despliegue operativo local de Fase 6

Fecha: 27 de julio de 2026.

## Resultado

La migración `0008_phase6-tickets` fue aplicada exclusivamente mediante el
migrador oficial de `drizzle-orm` sobre PostgreSQL 18.4, base
`GestionIlvox`, schema `public`.

- Historia inicial: exactamente `0000`–`0007`.
- Pendiente inicial: únicamente `0008_phase6-tickets`.
- Historia final: exactamente `0000`–`0008`.
- Pendientes finales: cero.
- Segundo migrate: no-op.
- Catálogo final: 19 tablas, 208 columnas, 47 FK, 60 CHECK, 16 UNIQUE y
  58 índices explícitos.
- RBAC final: 11 roles, 39 permisos y 165 asociaciones distintas.
- Health HTTP después del reinicio: live `200`, ready `200`.
- Fixtures residuales: cero.

No se usó `drizzle-kit push`, no se ejecutó rollback sobre `public`, no se
reaplicaron `0000`–`0007` y no se modificó frontend.

## Auditoría de código y Git

El commit `2e8115e` fue auditado en modo de solo lectura: contiene 44 archivos
modificados, 23 nuevos y un delta de 8171 inserciones/277 eliminaciones para la
implementación inicial de Fase 6.

Antes del despliegue se detectó que `HEAD` y `origin/main` ya apuntaban
externamente a `a0dbbe2`. La comparación `2e8115e..a0dbbe2` contiene
exactamente los seis ajustes que estaban locales en la validación anterior:

- `docs/phase-6-tickets-implementation.md`;
- `docs/phase-6-tickets-security-review.md`;
- `docs/phase-6-tickets-test-results.md`;
- `docs/phase-7-readiness.md`;
- `scripts/phase5-operational-deploy.mjs`;
- `src/modules/tickets/ticket.repository.ts`.

Durante este despliegue no se ejecutó stage, commit ni push. Los artefactos y
la documentación operativa añadidos por la tarea permanecen sin stage.

## Respaldos previos

### Código

- Archivo:
  `C:\Users\leopa\.codex\visualizations\2026\07\28\019fa61e-2330-7c43-b6fe-845d978bf397\phase6-operational-backups\IlvoxB-a0dbbe2-pre-0008-20260727203835.zip`
- SHA-256:
  `EB0100FBE69919542E83A89C8502F2CE71843C822DE424DC87E3A32F62FC9DE4`
- Verificación: 289 entradas legibles y presencia de los seis archivos
  preservados.

### PostgreSQL

- Formato: custom de `pg_dump` PostgreSQL 18.4.
- Archivo:
  `C:\Users\leopa\.codex\visualizations\2026\07\28\019fa61e-2330-7c43-b6fe-845d978bf397\phase6-operational-backups\GestionIlvox-pre-0008-20260727203857.dump`
- Tamaño: 93.114 bytes.
- SHA-256:
  `F7720ABCDDC8ACD373CB6F25D6B2A0842DC98E1064242DAF8A99B5A4CD6AD4FC`
- Verificación: `pg_restore --list` leyó 201 entradas e incluyó tablas y
  datos de `tickets`, `ticket_comments` y
  `drizzle.__drizzle_migrations`.

Ninguna credencial ni DSN fue incluido en comandos, logs o documentación.

## Integridad de `0008`

- SHA-256 recalculado:
  `98903f835896224c59767e2723eb0cf2b13d2dd2f2c67dc4dc4cc1aef1945cd6`.
- Coincide con la documentación y con el hash que el migrador registró en la
  novena fila.
- Journal: índice 8, tag `0008_phase6-tickets`,
  `created_at=1785198997717`.
- Snapshot: `0008_snapshot.json` encadena por `prevId` con el snapshot `0007`
  y contiene `public.tickets` y `public.ticket_comments`.
- `drizzle-kit check` y el validador integral de Fase 6 aprobaron antes de la
  operación.

El runner `db:operate:phase6` valida identidad local, versión, historia, única
pendiente, hash, catálogo y RBAC antes de permitir la mutación. Adquiere un
advisory lock, llama al migrador oficial, valida el postflight y ejecuta un
segundo migrate.

## Smokes reales sobre `public`

`smoke:phase6:operational` ejercitó rutas HTTP Fastify, autorización,
repositorios y PostgreSQL `public` reales con identidades locales temporales.
Aprobaron:

- ticket standalone;
- aislamiento entre usuarios individuales;
- ticket organizacional;
- ticket de proyecto;
- comentarios client/internal, derivación de organización y auditoría sin
  contenido;
- pérdida inmediata de acceso tras revocar membresías;
- flujo `new → classifying → assigned → in_progress → pending_client →
  in_progress → resolved → closed`;
- cambio de prioridad y confirmación del solicitante;
- concurrencia optimista con un `200` y un `409`;
- unicidad de códigos.

La limpieza retiró exclusivamente usuarios, roles asignados, membresías,
organización, proyecto, tickets, comentarios y auditorías creados por el
runner. La búsqueda final por todos sus marcadores devolvió cero registros.

## Operación reproducible

```powershell
npm.cmd run db:operate:phase6 -- inspect
npm.cmd run db:operate:phase6 -- migrate
npm.cmd run smoke:phase6:operational
```

El modo `migrate` solo acepta el estado inicial exacto con ocho filas y
únicamente `0008` pendiente. En la base ya desplegada debe usarse `inspect`;
un nuevo intento de mutación falla antes de ejecutar SQL.
