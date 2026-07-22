# Plan de pruebas de autenticación y autorización — Fase 3

Estado: diseñado, no implementado. Cada caso verifica código HTTP seguro, reason code interno, cero efectos laterales y auditoría cuando corresponda.

## Autenticación

- sin token; token inválido; expirado; issuer/audience incorrectos;
- usuario Clerk válido sin perfil local;
- local `pending`, `blocked` o `deleted`;
- usuario eliminado y evento duplicado/fuera de orden;
- roles/permisos/organización falsificados en body o metadata no confiable.

## Aislamiento organizacional

- actor A lee recurso A; intenta B por `organizationId`, `resourceId` y UUID válido conocido;
- múltiples membresías seleccionan una activa permitida; membresía `pending/revoked` deniega;
- recurso padre y `organizationId` discordantes;
- búsqueda, exportación, conteo y paginación no filtran totales/cursor de B.

## Escalación vertical

- admin se asigna o crea superadmin, modifica su scope o target equivalente;
- client_manager asigna rol interno; client_contact administra miembros;
- intento de desactivar/degradar último superadmin;
- repetición concurrente de asignación privilegiada y misma idempotency key;
- navegador altera roles/permisos/capabilities de `/me`.

## Tickets, comentarios y archivos

- cliente invoca `tickets.change_status`/`tickets.close`: denegado;
- confirmación válida `resolved→closed`, repetida idempotentemente y sobre otra organización;
- rechazo válido, sin motivo, con `targetStatus` manipulado y en estado distinto de `resolved`;
- reapertura desde `closed` dentro/fuera de ventana y desde estado inválido;
- cliente intenta leer/crear comentario interno;
- descarga archivo interno, object key ajeno, archivo de padre ajeno o sin audiencia cliente;
- carga cliente fuerza `classification`/padre interno: servidor ignora/deniega;
- carrera de dos transiciones: una gana, otra 409, un solo evento de auditoría efectivo.

## Repositorios

- scopes `global`, `organization`, `assigned`, `own`, `public`;
- scope ausente, vacío, manipulado o incompatible con actor;
- `organizations.access_all` sin permiso de acción y acción sin acceso transversal;
- joins, eager loading y agregaciones mantienen filtros;
- paginación y conteos no filtran existencia interorganizacional.

## Webhooks y `/me`

- firma ausente/inválida, replay, payload grande/malformado;
- duplicado procesado, reintento fallido, colisión de ID y evento fuera de orden;
- transacción revierte efecto si no puede marcar el evento;
- `/me` solo lista membresías activas, no expone token/secretos y sus capabilities no autorizan endpoints.

Mínimo de datos: dos organizaciones, actores de cada rol, dos proyectos/tickets con UUID conocidos, membresías activa/inactiva, comentarios interno/cliente, archivos con padres de distinta audiencia y dos superadmins para probar la guarda final.
