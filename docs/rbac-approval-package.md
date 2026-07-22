# Paquete de aprobación humana RBAC

Fecha: 2026-07-22. Decisión solicitada: aprobar el diseño, no ejecutar todavía el SQL.

## Cambio propuesto

Partida: 23 permisos / 142 asociaciones. Objetivo: **36 / 157**. Se agregan 13 permisos, se retiran 11 grants y se agregan 26. Los cinco permisos globales (`permissions.manage`, `roles.assign_super_admin`, `security.manage`, `system.configure`, `organizations.access_all`) son exclusivos de superadmin.

## Motivos

- separar admin operativo de control global;
- impedir transiciones arbitrarias de clientes;
- separar archivos cliente de permisos internos;
- diferenciar manager/contact y asegurar aislamiento por organización;
- hacer explícitas autoelevación, último superadmin, idempotencia y auditoría.

## Riesgos y mitigaciones

| Riesgo | Mitigación / condición de aprobación |
| --- | --- |
| bloqueo operativo de admins/clientes | desplegar servicios/actions antes o coordinados con grants; pruebas de regresión |
| archivo cliente sin audiencia persistente | fallar cerrado; habilitar solo padre cliente verificable; decidir migración futura |
| escalación vertical | jerarquía, transacción, último superadmin, no autoelevación y sesión reciente futura |
| fuga entre organizaciones | filtros SQL obligatorios y pruebas con UUID válido ajeno |
| drift código-semilla | auditoría de catálogo, conteos 36/157 y rollback ensayado |

## Evidencia a aprobar

- catálogo: `rbac-permission-catalog.md`;
- diferencias de roles: `rbac-role-differences.md`;
- acciones cliente: `ticket-client-actions.md`;
- modelo y contratos: `authorization-model.md`, `authorization-service-contract.md`, `repository-scope-contract.md`;
- borrador SQL: `proposals/rbac-changes-not-approved.sql` (termina en `ROLLBACK`).

## Gates antes de aplicar

1. Aprobación de producto, seguridad, backend y DBA.
2. Decisión explícita sobre audiencia de archivos directos.
3. Implementación y aprobación de pruebas Fase 3.
4. Backup/restore probado y staging con PostgreSQL 16.
5. Conteos precondición 23/142 y poscondición 36/157; cero duplicados.
6. Despliegue coordinado y plan de reversión.

Recomendación: **aprobar condicionalmente el diseño** e iniciar Fase 3 de contratos/pruebas; no aprobar aún la aplicación del SQL hasta resolver el gate de archivos y completar PostgreSQL 16.
