# Audiencia de archivos — Fase 3

Migración: `0002_phase3-file-audience.sql`. Agrega `files.audience varchar(20) NOT NULL DEFAULT 'internal'`, con `chk_files_audience` limitado a `internal|organization`. Los registros existentes quedan internos. El modelo ya exige `organization_id`, de modo que un archivo de organización nunca carece de propietario organizacional.

La restricción `chk_files_single_parent` pasa de exactamente uno a máximo uno para soportar archivos directos. Un archivo directo mantiene organización, uploader, metadata, hash/estado de análisis y audiencia. El índice parcial `idx_files_organization_audience_active` respalda consultas reales por organización/audiencia sobre archivos activos no eliminados.

La policy central exige:

- interno: permiso `files.read`/`files.upload` y acceso previamente scoped al recurso u organización;
- cliente: membresía activa coincidente, `files.read_client`/`files.upload_client`, audiencia `organization` y acceso al recurso;
- `client_contact`: sin carga directa;
- `client_manager`: carga directa únicamente en su organización;
- cuarentena o estado distinto de `active`: sin descarga;
- cambio de audiencia: solo interno autorizado y con auditoría.

El contenido no se almacena en PostgreSQL. `FileStorage` ofrece adaptadores local y en memoria y sirve como contrato para un proveedor S3-compatible futuro. No existen URLs públicas permanentes; los endpoints finales de carga/descarga quedan fuera de esta fase.
