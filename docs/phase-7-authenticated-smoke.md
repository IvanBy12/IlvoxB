# Fase 7.1 — Smoke autenticado final

Fecha: 27 de julio de 2026  
Frontend: `http://127.0.0.1:5173`  
Backend: `http://127.0.0.1:3001`

## Propósito y límites

Validar en navegador la integración real Clerk → bearer → `/me` → PostgreSQL →
guards/gates, sin inspeccionar ni persistir tokens, sin Clerk Organizations y
sin iniciar Fase 7.2. No se cambiaron endpoints, OpenAPI, migraciones ni módulos
de negocio.

## Identidad y fixture

- La instancia Clerk de desarrollo tenía una cuenta real.
- El perfil correspondiente ya existía por sincronización webhook y se vinculó
  exclusivamente por `clerk_user_id`.
- Antes del fixture el perfil estaba `pending`; el login autenticó en Clerk,
  `/me` respondió 403 y la UI mostró “Acceso no habilitado”.
- Con autorización expresa se activó temporalmente ese perfil y se añadieron un
  rol global `contributor`, una organización activa temporal y una membership
  `client_contact`.
- El perfil efectivo tuvo 2 roles, 17 permisos únicos y 1 organización.
- No se creó manualmente ningún `app_user` ni se usaron metadata/email como
  autoridad.

## Recorrido positivo

1. `/me` respondió 200 con la sesión real.
2. `/login` redirigió a `/app` para la identidad con capacidades internas y de
   cliente.
3. El deep link `/portal/tickets` se conservó.
4. La vista “Mis tickets” mostró “Nuevo ticket”, comprobando el gate
   `tickets.create`.
5. La navegación no expuso Documentos, Notificaciones, Auditoría ni RBAC.
6. `/app/auditoria` mostró la página 404 neutral, sin seed de esa función.

## Recorridos negativos y recuperación

- Al detener el backend, `/portal/tickets` mostró un error de conexión y
  “Reintentar”; no mostró contenido protegido.
- Tras reiniciar el backend, Reintentar recuperó el mismo deep link.
- El logout llevó a `/login`; una navegación directa a `/portal/tickets`
  permaneció bloqueada y `/me` sin token respondió 401.
- Una reautenticación posterior produjo un nuevo preflight 204 y un nuevo
  `GET /me` 200, confirmando una consulta de identidad nueva.
- Los casos `PermissionGate` `one`/`any`/`all` y fail closed, incluidos permisos
  ausentes, están cubiertos por la suite unitaria.

## CORS, health y seguridad

| Comprobación | Resultado |
| --- | --- |
| `/health/live` | 200 |
| `/health/ready` | 200 |
| Preflight desde `http://127.0.0.1:5173` | 204 y ACAO exacto |
| Preflight desde `http://localhost:5173` | 404, sin ACAO |
| Metadata/email como autoridad en `src` | sin coincidencias |
| Token en local/session storage | sin coincidencias |
| Secretos backend en frontend | sin coincidencias |
| Logging de bearer/authorization | sin coincidencias |
| Scope por `clienteId` en `src` | sin coincidencias |

## Validaciones finales

| Repositorio | Comando | Resultado |
| --- | --- | --- |
| IlvoxF | `npm run typecheck` | PASS |
| IlvoxF | `npm test` | PASS, 7/7 |
| IlvoxF | `npm run build` | PASS |
| IlvoxF | `npm run check` | PASS |
| IlvoxB | `npm run check` | PASS, 102 tests + 6 constraints |

El build frontend conserva una advertencia no bloqueante por tamaño de chunk.
Los advisories conocidos permanecen en 1 moderado y 2 altos; no se ejecutó
ninguna corrección de auditoría.

## Limpieza y decisión

El cierre eliminó exactamente la organización, membership y rol global
temporales, y restauró el perfil a `pending`. Verificación final:
0 organizaciones, 0 memberships, 0 roles temporales y 1 perfil `pending`.

**Decisión:** el gate técnico de Fase 7.1 está cerrado. Fase 7.2 puede ser
considerada por el propietario, pero no fue iniciada ni queda autorizada por
este documento.
