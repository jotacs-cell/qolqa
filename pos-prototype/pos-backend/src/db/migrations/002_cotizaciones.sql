-- =====================================================================
-- Migración 002: cotizaciones
-- =====================================================================
-- Fase 4 del roadmap (Ventas): una cotización es una venta que todavía no
-- se confirma — no descuenta stock, no reserva serie/correlativo SUNAT, no
-- genera comprobante. Al "Confirmar" (ver cotizaciones.controller.js) recién
-- ahí se llama a ventas.service.js#registrarVenta con sus mismas líneas,
-- exactamente como si se hubiera hecho una venta nueva a mano — mismo
-- camino, ninguna lógica duplicada.
-- =====================================================================

BEGIN;

CREATE TYPE estado_cotizacion AS ENUM ('borrador', 'enviada', 'confirmada', 'vencida', 'rechazada');

CREATE TABLE cotizaciones (
    id                  BIGSERIAL PRIMARY KEY,
    company_id          BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    usuario_id          BIGINT              NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    cliente_id          BIGINT              REFERENCES clientes(id) ON DELETE SET NULL,
    estado              estado_cotizacion   NOT NULL DEFAULT 'borrador',
    fecha_cotizacion    TIMESTAMPTZ         NOT NULL DEFAULT now(),
    fecha_vencimiento   DATE,
    notas               TEXT,
    -- Se llena solo al confirmar — el puente hacia la venta/comprobante real.
    venta_id            BIGINT              REFERENCES ventas(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_cotizaciones_company ON cotizaciones (company_id);
CREATE INDEX idx_cotizaciones_estado ON cotizaciones (estado);

CREATE TABLE cotizacion_items (
    id                  BIGSERIAL PRIMARY KEY,
    cotizacion_id       BIGINT              NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    producto_id         BIGINT              NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad            INTEGER             NOT NULL CHECK (cantidad > 0),
    precio_unitario     NUMERIC(12,2)       NOT NULL CHECK (precio_unitario >= 0),
    descuento_pct       NUMERIC(5,2)        NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
    subtotal            NUMERIC(12,2)       NOT NULL CHECK (subtotal >= 0)
);

CREATE INDEX idx_cotizacion_items_cotizacion ON cotizacion_items (cotizacion_id);

COMMIT;
