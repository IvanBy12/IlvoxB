# Revisión de seguridad — Fase 3

Fecha de actualización: 23 de julio de 2026.

## Controles cerrados

- Clerk autentica y PostgreSQL autoriza.
- `@clerk/fastify` verificó un session token real con authorized party explícita.
- Una sesión válida no evita la comprobación de perfil local activo.
- Perfil ausente, pending, blocked y deleted fallan cerrado.
- Solo las membresías activas ingresan en `ActorContext`; una membresía revocada no concede acceso.
- Roles, permisos y capacidades proceden de PostgreSQL, no de claims o metadata del frontend.
- Aislamiento A/B devuelve 404 y el interno limitado no obtiene alcance transversal.
- Archivos internos no son visibles para clientes; cuarentena bloquea lectura; cargas aprobadas no producen URL pública permanente.
- Acciones sensibles producen `auditRequired=true`.
- Admin no puede asignar super_admin; super_admin no puede autoasignarse.
- El Signing Secret expuesto fue rotado y la nueva referencia aprobó un smoke real corto.
- No se registraron ni persistieron tokens, contraseñas temporales, firmas, payloads o URLs de DB.

## Decisión de identidad y costo

La instancia Clerk Development usada para integración está en `Membership optional / Personal Accounts`. ILVOX no necesita organizaciones Clerk: organizaciones, membresías y RBAC permanecen en PostgreSQL. La validación creó un solo usuario Clerk temporal, ninguna organización Clerk, y eliminó el usuario en la misma ejecución.

## Riesgos restantes

- Staging y producción deben permanecer en PostgreSQL 18.x. Cualquier cambio de versión exige repetir baseline, migraciones, rollback, catálogo y pruebas.
- La configuración de cada despliegue debe habilitar auth y definir authorized parties exactas; el backend necesita conectividad para verificar tokens Clerk.
- Los futuros listados de archivos deben excluir estados no activos mediante SQL o policy por fila. La policy de descarga ya bloquea cuarentena.
- S3-compatible, antivirus, URLs temporales, monitoreo y dead-letter siguen perteneciendo a fases posteriores.
- No existen todavía endpoints productivos completos de roles, tickets o archivos.
- La auditoría npm completa conserva el riesgo histórico de dependencias transitivas de desarrollo; no se aplicó una actualización breaking.

## Cierre

Clerk staging ya no es un gate pendiente. No quedan gates externos abiertos para Fase 3.5. Los riesgos enumerados son condiciones de implementación/operación de Fase 4 y no autorizan comenzar esa fase automáticamente.
