-- =====================================================================
-- Migración 004: pedidos
-- =====================================================================
-- Fase 4 del roadmap (Ventas): un pedido es el paso firme entre la
-- cotización aceptada y la factura — a diferencia de la cotización, SÍ
-- reserva stock (compromiso real de entrega), pero todavía no descuenta
-- stock de verdad ni genera comprobante hasta que se factura.
--
-- Flujo: Cotización (opcional) → Pedido "borrador" → "confirmado"
-- (reserva stock) → "facturado" (llama a ventas.service.js#registrarVenta,
-- ahí SÍ se descuenta stock de verdad y se libera la reserva) — mismo
-- patrón que cotizaciones.controller.js#confirmar, ninguna lógica
-- duplicada. "cancelado" libera la reserva sin facturar.
-- =====================================================================

BEGIN;

CREATE TYPE estado_pedido AS ENUM ('borrador', 'confirmado', 'facturado', 'cancelado');

-- Cuánta unidad está comprometida en pedidos "confirmado" (no facturados
-- todavía) — el stock realmente disponible para vender es stock - stock_reservado.
ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock_reservado INTEGER NOT NULL DEFAULT 0 CHECK (stock_reservado >= 0);

CREATE TABLE pedidos (
    id                  BIGSERIAL PRIMARY KEY,
    company_id          BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    usuario_id          BIGINT              NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    cliente_id          BIGINT              REFERENCES clientes(id) ON DELETE SET NULL,
    cotizacion_id       BIGINT              REFERENCES cotizaciones(id) ON DELETE SET NULL,
    estado              estado_pedido       NOT NULL DEFAULT 'borrador',
    fecha_pedido        TIMESTAMPTZ         NOT NULL DEFAULT now(),
    fecha_entrega       DATE,
    notas               TEXT,
    -- Se llena solo al facturar — el puente hacia la venta/comprobante real.
    venta_id            BIGINT              REFERENCES ventas(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_pedidos_company ON pedidos (company_id);
CREATE INDEX idx_pedidos_estado ON pedidos (estado);

CREATE TABLE pedido_items (
    id                  BIGSERIAL PRIMARY KEY,
    pedido_id           BIGINT              NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    producto_id         BIGINT              NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad            INTEGER             NOT NULL CHECK (cantidad > 0),
    precio_unitario     NUMERIC(12,2)       NOT NULL CHECK (precio_unitario >= 0),
    descuento_pct       NUMERIC(5,2)        NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
    subtotal            NUMERIC(12,2)       NOT NULL CHECK (subtotal >= 0)
);

CREATE INDEX idx_pedido_items_pedido ON pedido_items (pedido_id);

COMMIT;
