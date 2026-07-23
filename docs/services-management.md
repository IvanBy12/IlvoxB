# Administración del catálogo de servicios

## Permiso

`services.manage`, scope global, concedido únicamente a:

- `global:super_admin`;
- `global:admin`.

No se concede a sales, soporte, roles de proyecto ni roles cliente.

## Rutas

- `POST /api/v1/admin/services`
- `PATCH /api/v1/admin/services/:serviceId`

Usan exclusivamente `name`, `category`, `description`, `isPublic` e `isActive`. No existe
eliminación física, precio, orden, slug, CMS, archivos o planes.

Crear o actualizar se realiza dentro de una transacción con auditoría. El nombre duplicado
devuelve 409. Un actor cliente recibe 403 incluso si se construyera artificialmente un
permiso global en su contexto.

El catálogo público exige simultáneamente `is_public=true` e `is_active=true`; ocultar o
desactivar elimina el registro de las rutas públicas de inmediato, pero no de administración.

## Estado desplegado

0005 está aplicada sobre `GestionIlvox.public`: `services.manage` tiene exactamente dos grants,
en `global:super_admin` y `global:admin`.

El smoke real aprobó creación 201, listas administrativa/pública, ocultamiento, republicación,
desactivación, 403 sin permiso/cliente, 409 duplicado, 400 para body inválido y campo
desconocido, y ausencia de DELETE. La auditoría no conserva la descripción completa.

Durante el smoke se detectó que Fastify eliminaba campos adicionales. Se configuró
`removeAdditional=false`, los schemas se cerraron con `additionalProperties=false` y se añadió
una regresión HTTP automatizada.
