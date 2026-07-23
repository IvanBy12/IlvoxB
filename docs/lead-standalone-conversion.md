# Conversión standalone de leads

Endpoint: `POST /api/v1/leads/:leadId/convert`.

## Modalidades

### `standalone`

Requiere actor interno activo y `leads.manage`. No requiere `organizations.manage`.

```json
{ "mode": "standalone" }
```

El repositorio bloquea el lead con `FOR UPDATE`, exige `approved`, asigna `converted`,
establece `converted_at`, conserva `converted_organization_id=NULL` y registra auditoría.
No crea organización, contacto, membresía, usuario, sesión ni identidad Clerk.

### `create_organization`

Requiere además `organizations.manage`. Crea una organización en la misma transacción,
respeta la unicidad país+identificador fiscal y vincula el lead. No fusiona por nombre.

### `reuse_organization`

Requiere además `organizations.manage`, ID explícito y scope autorizado. La organización
debe existir y estar activa.

## Respuesta

```json
{
  "data": {
    "mode": "standalone",
    "leadId": "uuid",
    "organizationCreated": false,
    "organizationId": null,
    "status": "converted",
    "idempotent": false,
    "primaryContactCreated": false
  }
}
```

## Idempotencia

La modalidad queda registrada en `audit_events` dentro de la transacción. Un reintento con
la misma modalidad devuelve el mismo vínculo y `idempotent=true`. Cambiar entre standalone,
crear o reutilizar después de convertir devuelve 409. Dos conversiones concurrentes se
serializan por el lock del lead.

El rollback de 0004 se niega mientras existan leads convertidos standalone; exige una
decisión de datos explícita antes de restaurar el check antiguo.

## Validación de despliegue

0004 está aplicada sobre `GestionIlvox.public`. El smoke HTTP real aprobó:

- primera conversión 200 e `idempotent=false`;
- reintento 200 e `idempotent=true`;
- modalidad incompatible 409;
- concurrencia 200/200 con una conversión efectiva;
- create/reuse, no merge por nombre y rollback transaccional;
- cero organizaciones o memberships para standalone;
- cero contactos, usuarios Clerk y sesiones Clerk;
- auditoría única y sin email/nombre del lead.

Los fixtures fueron eliminados.
