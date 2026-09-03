-- =====================================================================
-- Migración 015: Cobros parciales de ventas a crédito
-- =====================================================================
-- Hasta ahora "Cuentas por cobrar" solo podía marcar una venta a crédito
-- como pagada de un tirón (ventas.estado_pago: 'pendiente' -> 'pagada'),
-- sin forma de registrar un abono parcial ni de saber cuánto se lleva
-- cobrado. Se agrega 'parcial' al enum ya existente y una bitácora de
-- cobros (pagos_venta, un pago por fila — igual patrón que notas_venta)
-- para poder sumarlos y comparar contra ventas.total.
-- =====================================================================

BEGIN;

ALTER TYPE estado_pago_compra ADD VALUE 'parcial';

CREATE TABLE pagos_venta (
    id          BIGSERIAL PRIMARY KEY,
    venta_id    BIGINT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    monto       NUMERIC(12,2) NOT NULL CHECK (monto > 0),
    metodo_pago metodo_pago_venta NOT NULL,
    usuario_id  BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pagos_venta_venta_id ON pagos_venta (venta_id);

COMMIT;
