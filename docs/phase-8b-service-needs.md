# Fase 8B — Servicios orientados a necesidades

## Alcance y contrato

La fase incorpora una taxonomía editable de necesidades de negocio, separada del catálogo técnico de servicios. `service_needs` conserva un `code` estable y único, textos públicos sin HTML, clave de icono, orden y estados `is_public`/`is_active`; los títulos duplicados se controlan de forma transaccional y sin distinguir mayúsculas. `service_need_links` relaciona servicios existentes con peso `1..100` y marca principal; su clave compuesta evita duplicados y sus referencias usan `ON DELETE RESTRICT`. No se expone eliminación física.

Las lecturas públicas `GET /api/v1/service-needs`, `GET /api/v1/service-needs/:needId` y `GET /api/v1/service-needs/:needId/services` no requieren token, aplican límite de 60 solicitudes por minuto y sólo muestran necesidades y servicios públicos y activos. Los resultados se ordenan por `display_order` y, para relaciones, por principal, peso y nombre; cada servicio relacionado expone únicamente id, nombre, categoría y descripción. Un recurso oculto o inexistente produce el mismo 404 neutral. Éste es el contrato único elegido; no se amplió `GET /services` con `needId`.

La administración usa `services.read` para listas/detalles y `services.manage` para crear, actualizar y reemplazar relaciones. `PUT /api/v1/admin/service-needs/:needId/services` bloquea la necesidad y reemplaza todas sus relaciones dentro de una transacción; rechaza IDs repetidos o servicios inexistentes. No se añadieron permisos, roles ni superficies de RBAC.

## Datos y operación local

La migración formal es `0010_phase8b-service-needs` y tiene rollback explícito. El seed `npm run seed:service-needs` inserta, con `ON CONFLICT DO NOTHING`, los diez códigos aprobados; una ejecución posterior no sobrescribe ediciones y nunca crea vínculos inventados. La migración y el seed se aplican únicamente al PostgreSQL local configurado por `DATABASE_URL`; esta fase no autoriza push ni despliegue remoto.

Validación recomendada:

```text
npm run db:check
npm run check
npm run smoke:phase8b:service-needs
```

El smoke usa el prefijo `PHASE8B_SMOKE_`, cubre tres necesidades públicas, una privada, varios servicios, una relación compartida, pesos/principal, orden, filtros, edición administrativa y rechazo de servicios inexistentes; termina con `residualFixtures: 0`.

## Experiencia web

`/servicios` consume la API real y permite una sola necesidad activa: seleccionar otra reemplaza el panel y seleccionar la misma lo cierra. El panel ofrece explicación, servicios relacionados y navegación a `/diagnostico?need=<code>`; no calcula resultados, persiste diagnósticos ni crea leads automáticamente. `/diagnostico` valida el código contra el catálogo público y omite de forma segura valores desconocidos. “Todos nuestros servicios” conserva el catálogo completo existente.

En `/app/administracion`, Servicios y Necesidades están visualmente separados. Necesidades permite búsqueda, filtros de estado, orden, textos, publicación/actividad y relaciones con principal/peso. Las mutaciones usan TanStack Query sin reintentos, bloqueo de doble envío e invalidación/refetch; ante 409 el formulario se conserva.

Fuera de alcance: Fase 8C, simulador o motor de reglas, diagnóstico persistente, Personal/7.6, IA, archivos, notificaciones y administración de RBAC.
