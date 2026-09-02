-- =====================================================================
-- Migración 006: transferencias entre almacenes
-- =====================================================================
-- Una transferencia mueve stock de un almacén a otro de la MISMA empresa
-- — no cambia el total de la empresa (kardex.service.js#registrarMovimiento
-- ya se encarga de eso), solo redistribuye. Cada transferencia genera DOS
-- movimientos de kardex (salida del origen, entrada al destino) con esta
-- fila como referencia común.
-- =====================================================================

BEGIN;

CREATE TABLE transferencias (
    id                  BIGSERIAL           PRIMARY KEY,
    company_id          BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    producto_id         BIGINT              NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    almacen_origen_id   BIGINT              NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
    almacen_destino_id  BIGINT              NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
    cantidad            INTEGER             NOT NULL CHECK (cantidad > 0),
    motivo              VARCHAR(300),
    usuario_id          BIGINT              NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    creado_en           TIMESTAMPTZ         NOT NULL DEFAULT now(),
    CHECK (almacen_origen_id <> almacen_destino_id)
);

CREATE INDEX idx_transferencias_company ON transferencias (company_id);

COMMIT;
