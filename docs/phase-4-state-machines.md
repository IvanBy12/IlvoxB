# Máquina de estados de leads

La implementación central está en `src/common/state-machines/lead-transitions.ts`.

Estados PostgreSQL exactos:

`new`, `contacted`, `in_diagnostic`, `quotation`, `proposal_sent`, `negotiation`,
`approved`, `not_approved`, `converted`.

## Transiciones

- `new → contacted`
- `contacted → in_diagnostic`
- `in_diagnostic → quotation`
- `quotation → proposal_sent`
- `proposal_sent → negotiation`
- `negotiation → approved`
- cualquier estado no terminal anterior puede pasar a `not_approved` con motivo;
- `not_approved → contacted` con motivo de reapertura;
- `approved → converted` exclusivamente mediante conversión transaccional;
- `converted` es terminal.

Requiere actor interno con `leads.manage`. El motivo se guarda únicamente como metadato
redactado de auditoría porque no existe columna de motivo. La actualización usa el estado
observado en el `WHERE`; un cambio concurrente produce 409. La conversión usa `FOR UPDATE`.
