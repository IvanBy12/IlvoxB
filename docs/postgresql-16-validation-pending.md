# PostgreSQL 16 — validación pendiente

Estado: pendiente y bloqueante para compatibilidad oficial/producción; no bloquea el cierre de implementación de Fase 3.

Esta ejecución no instaló PostgreSQL, Docker ni Podman y no determinó la versión del servidor configurado como PostgreSQL 16. Por tanto, no se afirma compatibilidad oficial.

Antes de promover las migraciones se debe usar una instancia PostgreSQL 16 aislada para:

1. aplicar la baseline exacta y verificar su hash;
2. aplicar `0001`, `0002` y `0003` transaccionalmente;
3. ejecutar catálogo, RBAC y toda la suite con DB;
4. probar rollbacks en orden inverso;
5. confirmar planes del índice de archivos y locks concurrentes;
6. eliminar los recursos temporales y registrar versión exacta del servidor.

Solo después debe autorizarse una ventana separada de migración sobre producción. `drizzle-kit push` no forma parte de ese procedimiento.
