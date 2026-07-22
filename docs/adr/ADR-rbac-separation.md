# ADR: separación de privilegios RBAC

- Estado: Propuesto; requiere aprobación humana
- Fecha: 2026-07-22

## Contexto

La semilla da los mismos 23 permisos a `admin` y `super_admin`, y los mismos nueve a ambos roles cliente. Los clientes poseen transiciones de ticket y permisos de archivo demasiado genéricos. Un permiso tampoco codifica alcance de fila.

## Decisión propuesta

Combinar permisos semánticos con scopes y consultas filtradas. Reservar a superadmin las capacidades globales; dar a admin reemplazos operativos acotados; sustituir cambios genéricos de ticket por intenciones; separar el canal de archivos cliente; distinguir manager/contact por membresía, ownership y asignación.

Alternativas rechazadas: condicionales solo por nombre de rol (bypass/acoplamiento), un permiso por endpoint (explosión), o una migración meramente estética de constraints.

## Consecuencias

La propuesta pasa de 23 a 36 permisos y de 142 a 157 asociaciones: retira 11 y agrega 26. Requiere despliegue coordinado, pruebas negativas, telemetría y aprobación. Hasta entonces el catálogo y los usuarios no cambian.

El modelo de archivos tiene una brecha de audiencia: `classification` no significa visibilidad. Los permisos cliente deben fallar cerrado para padres no demostrablemente públicos; una migración futura puede añadir audiencia explícita, pero no forma parte de esta fase.

## Controles

Migración futura transaccional y revisada, conteos antes/después, protección del último superadmin, idempotencia, auditoría, filtros SQL obligatorios y plan de rollback. El borrador actual termina en `ROLLBACK`.
