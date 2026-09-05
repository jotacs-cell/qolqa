-- =====================================================================
-- Migración 016: Venta por unidad mayor (caja/paquete) además de la
-- unidad menor (unidad suelta) — Fase de mejoras del sistema de ventas.
-- =====================================================================
-- Contexto: hay productos que se compran/venden por caja o paquete
-- (ej. una caja de 10 botellas) pero el inventario siempre se maneja en
-- la unidad menor (la botella individual) para mayor precisión de
-- stock. Esto es OPCIONAL por producto — todo lo que no lo configure
-- sigue funcionando exactamente igual que antes (unidad simple).
-- =====================================================================

BEGIN;

-- Config de la unidad mayor en el producto: o las 4 columnas están
-- completas, o las 4 están vacías (no tiene sentido una caja "a medias").
ALTER TABLE productos ADD COLUMN unidad_mayor_nombre VARCHAR(30);
ALTER TABLE productos ADD COLUMN unidad_mayor_codigo_sunat VARCHAR(3);
ALTER TABLE productos ADD COLUMN unidad_mayor_factor INTEGER CHECK (unidad_mayor_factor IS NULL OR unidad_mayor_factor > 1);
ALTER TABLE productos ADD COLUMN unidad_mayor_precio_venta NUMERIC(12,2) CHECK (unidad_mayor_precio_venta IS NULL OR unidad_mayor_precio_venta >= 0);
ALTER TABLE productos ADD CONSTRAINT chk_unidad_mayor_completa CHECK (
  (unidad_mayor_nombre IS NULL AND unidad_mayor_codigo_sunat IS NULL AND unidad_mayor_factor IS NULL AND unidad_mayor_precio_venta IS NULL)
  OR
  (unidad_mayor_nombre IS NOT NULL AND unidad_mayor_codigo_sunat IS NOT NULL AND unidad_mayor_factor IS NOT NULL AND unidad_mayor_precio_venta IS NOT NULL)
);

-- detalle_ventas congela qué unidad se vendió en CADA línea (igual
-- criterio que precio_unitario_historico: si el producto cambia su
-- configuración de unidad mayor después, esta venta ya emitida no debe
-- cambiar de significado). factor_conversion es cuántas unidades menor
-- (stock real) representa cada "cantidad" de esta línea — 1 para una
-- venta normal, el factor configurado del producto si se vendió por
-- unidad mayor.
ALTER TABLE detalle_ventas ADD COLUMN unidad_nombre VARCHAR(30) NOT NULL DEFAULT 'UNIDAD';
ALTER TABLE detalle_ventas ADD COLUMN unidad_medida_codigo VARCHAR(3) NOT NULL DEFAULT 'NIU';
ALTER TABLE detalle_ventas ADD COLUMN factor_conversion INTEGER NOT NULL DEFAULT 1 CHECK (factor_conversion > 0);

COMMIT;
