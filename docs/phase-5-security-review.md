# Revisión de seguridad de Fase 5

## Controles validados

- autenticación y perfil local activo;
- permisos efectivos y scope SQL previo a consultas y mutaciones;
- miembros revocados excluidos de identidad, scopes, tareas, listados y elegibilidad;
- revocación histórica idempotente, con lock, actor, fecha y auditoría;
- FK compuesta de entregable a hito del mismo proyecto y organización;
- bodies cerrados y campos de tenant/contexto protegidos;
- locks y `expectedUpdatedAt` con respuesta 409;
- auditoría transaccional redactada;
- sin borrado de usuario, Clerk, organización, tareas históricas o membresías;
- sin tickets, comentarios, archivos, URLs ni almacenamiento nuevos.

## Riesgos y gates restantes

1. `GestionIlvox.public` tiene físicamente 0001–0005, pero no existe
   `drizzle.__drizzle_migrations`. Ejecutar el migrador antes de reconocer de forma segura
   toda la historia 0000–0005 intentaría repetir migraciones.
2. 0006–0007 están validadas, pero pendientes de despliegue explícitamente autorizado.
3. `projects.manage` sigue agrupando proyecto, miembros, hitos y entregables.
4. `npm audit` quedó inconcluso porque el entorno no autorizó enviar metadatos al registro.
   Debe repetirse antes de despliegue público; no se afirma cero vulnerabilidades.

No se ejecutó `audit fix`, `drizzle-kit push`, reconocimiento de baseline, commit ni push.
