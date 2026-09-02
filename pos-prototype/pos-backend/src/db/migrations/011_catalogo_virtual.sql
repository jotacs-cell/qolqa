-- =====================================================================
-- Migración 011: catálogo virtual público (solo lectura, sin carrito)
-- =====================================================================
-- Cada empresa puede activar una página pública (sin login) que lista
-- sus productos activos con foto y precio, con un botón "Pedir por
-- WhatsApp" en vez de un carrito de compra + pasarela de pago — es lo
-- que la mayoría de sistemas peruanos similares llaman "catálogo
-- virtual". catalogo_slug es la dirección pública (ej. /catalogo/?e=
-- ferreteria-sanmartin); si es NULL, la empresa simplemente no tiene
-- catálogo publicado todavía.
-- =====================================================================

BEGIN;

ALTER TABLE empresas ADD COLUMN catalogo_slug VARCHAR(80) UNIQUE;
ALTER TABLE empresas ADD COLUMN catalogo_whatsapp VARCHAR(20);

ALTER TABLE productos ADD COLUMN imagen_url TEXT;

COMMIT;
