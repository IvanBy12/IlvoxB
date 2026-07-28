# Readiness de archivos después de Fase 6

Archivos no se implementaron.

`files.organization_id` sigue `NOT NULL` y sus FKs a ticket, comentario y tarea
son compuestas con organización. Por ello no puede representar de forma segura
archivos de tickets standalone.

Gate para una fase futura:

1. decidir ownership y audiencia de archivos standalone;
2. añadir FK simple obligatoria al padre;
3. garantizar igualdad nullable mediante derivación/trigger;
4. mantener exactamente un padre;
5. diseñar cuarentena, escaneo y borrado;
6. autorizar proveedor y ciclo de URLs por separado;
7. probar aislamiento, revocación y expiración.

No se volvió nullable `files.organization_id`, no se insertaron archivos y no
se creó S3, R2, storage local, carga, descarga ni URL firmada.
