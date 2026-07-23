# Resultados Clerk staging — Fase 3.5

Fecha: 23 de julio de 2026.  
Resultado: **aprobado**.

| Área | Resultado runtime |
| --- | --- |
| Sesión personal Clerk | `active`, sin tarea pendiente |
| Organización Clerk creada | Ninguna |
| Sin token / token inválido | `401 UNAUTHENTICATED` |
| Session token real | Verificado por `@clerk/fastify` |
| Perfil local ausente | `403 FORBIDDEN` |
| Perfiles `pending`/`blocked`/`deleted` | `403 FORBIDDEN` |
| `/me` cliente A | 200; una membresía activa `client_manager`; revocada omitida |
| `/me` cliente B | 200; una membresía activa `client_contact` |
| `/me` multi-organización | 200; dos membresías y roles correctos |
| `/me` interno limitado | 200; sin membresías inventadas ni acceso transversal |
| `/me` admin/super_admin | 200; permisos efectivos esperados |
| Campos sensibles en `/me` | No detectados |
| Acceso cross-org cliente | 404 |
| Archivo interno desde cliente | 404 |
| Archivo en cuarentena | 403 |
| Archivo propio `organization` | 200 |
| Carga cliente manager | 201; `publicUrl=null` |
| Carga directa client contact | 403 por policy |
| Carga interna super_admin | 201; `publicUrl=null` |
| Admin → super_admin | 403; `auditRequired=true` |
| Super_admin → sí mismo | 403; `auditRequired=true` |
| Super_admin → otro usuario | Permitido; `auditRequired=true` |
| Gestión global de permisos | Permitida solo a super_admin; `auditRequired=true` |

## Webhook y secreto rotado

El Signing Secret anterior fue rotado. La nueva referencia aprobó un smoke corto real de creación/eliminación y limpió los dos eventos generados. La matriz exhaustiva previa de firma, idempotencia, retry y orden no se repitió.

## Limpieza confirmada

- Usuarios Clerk temporales residuales: 0.
- Organizaciones Clerk creadas: 0.
- Organizaciones PostgreSQL temporales residuales: 0.
- Archivos de fixture residuales: 0.
- Estado/herramientas/tokens persistidos: 0.

## Hallazgo de integración para Fase 4

`authorizeFileRead` bloquea correctamente estados distintos de `active`. Al construir endpoints de listado, cada fila o la consulta SQL debe aplicar también ese estado; no basta con el scope organizacional del repositorio. No existe todavía un endpoint productivo de listado, por lo que se registra como condición de implementación y prueba de Fase 4, no como cambio autorizado en esta fase.
