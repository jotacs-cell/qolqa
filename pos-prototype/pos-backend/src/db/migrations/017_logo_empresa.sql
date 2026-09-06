-- =====================================================================
-- Migración 017: Logo de la empresa en los comprobantes impresos
-- =====================================================================
-- Se guarda como data URI (data:image/png;base64,...) directamente en
-- la base de datos, no como archivo en disco: Railway no da almacenamiento
-- persistente al servicio del backend (un redeploy borra cualquier
-- archivo subido), así que un logo por empresa —una sola imagen chica—
-- vive mejor como un campo más de `empresas` que dependiendo de
-- infraestructura de archivos que este proyecto no tiene todavía.
-- =====================================================================

ALTER TABLE empresas ADD COLUMN logo_base64 TEXT;
