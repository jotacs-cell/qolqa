-- Línea de tiempo de notas manuales sobre una venta/comprobante — igual
-- que "Registrar una nota" en un sistema de facturación real (Odoo, etc.):
-- texto libre, quién la escribió y cuándo, sin editar ni borrar después
-- (es una bitácora, no un campo editable).
CREATE TABLE notas_venta (
    id          BIGSERIAL PRIMARY KEY,
    venta_id    BIGINT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    usuario_id  BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    texto       TEXT NOT NULL,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notas_venta_venta_id ON notas_venta (venta_id);
