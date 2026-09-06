-- =====================================================================
-- Migración 018: Op. exonerada/inafecta en el comprobante (para el
-- reporte de ventas detallado y para que lo guardado en la base
-- coincida con lo que realmente se categoriza al enviar a NubeFacT)
-- =====================================================================
-- comprobantes_electronicos solo guardaba operacion_gravada — como si
-- TODO lo vendido fuera gravado al 18%, sin importar la afectación IGV
-- real de cada producto (ver productos.codigo_afectacion_igv). Ahora se
-- guardan también las cubetas exonerada/inafecta, calculadas línea por
-- línea con el mismo criterio que nubefactClient.js usa para el envío
-- real (ver catalogosSunat.js#categorizarLineaIgv).
-- =====================================================================

ALTER TABLE comprobantes_electronicos ADD COLUMN operacion_exonerada NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (operacion_exonerada >= 0);
ALTER TABLE comprobantes_electronicos ADD COLUMN operacion_inafecta NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (operacion_inafecta >= 0);
