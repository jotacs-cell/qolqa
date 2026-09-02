-- =====================================================================
-- Migración 007: compras (Fase 6 — simétrico a ventas de la Fase 4)
-- =====================================================================
-- proveedores es igual a clientes; compras+detalle_compras es igual a
-- ventas+detalle_ventas (pero suma stock en vez de restarlo, vía
-- kardex.service.js); ordenes_compra+orden_compra_items es igual a
-- pedidos+pedido_items (borrador -> confirmada -> recibida genera la
-- compra real, igual que pedido.facturar genera la venta real).
--
-- A diferencia de una venta, una compra NO emite ningún documento propio
-- ante SUNAT — el comprobante lo emite el PROVEEDOR; acá solo se guarda
-- su número de referencia (numero_factura_proveedor) para contabilidad.
-- Por eso no hay comprobantes_electronicos ni NubeFacT de por medio.
-- =====================================================================

BEGIN;

CREATE TABLE proveedores (
    id                      BIGSERIAL           PRIMARY KEY,
    company_id              BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tipo_documento          tipo_documento_cliente NOT NULL DEFAULT 'sin_documento',
    numero_documento        VARCHAR(20),
    razon_social_o_nombre   VARCHAR(200)        NOT NULL,
    direccion               VARCHAR(255),
    telefono                VARCHAR(20),
    email                   VARCHAR(150),
    creado_en               TIMESTAMPTZ         NOT NULL DEFAULT now(),

    UNIQUE (company_id, numero_documento)
);

CREATE INDEX idx_proveedores_company ON proveedores (company_id);

CREATE TYPE estado_pago_compra AS ENUM ('pendiente', 'pagada');

CREATE TABLE compras (
    id                          BIGSERIAL               PRIMARY KEY,
    company_id                  BIGINT                  NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    usuario_id                  BIGINT                  NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    proveedor_id                BIGINT                  REFERENCES proveedores(id) ON DELETE SET NULL,
    fecha                       TIMESTAMPTZ             NOT NULL DEFAULT now(),
    -- Referencia al comprobante que emitió el PROVEEDOR — no es un
    -- documento propio, solo un dato para cuentas por pagar/contabilidad.
    numero_factura_proveedor    VARCHAR(50),
    total                       NUMERIC(12,2)           NOT NULL CHECK (total >= 0),
    estado_pago                 estado_pago_compra      NOT NULL DEFAULT 'pendiente',
    estado_documento            estado_documento_venta  NOT NULL DEFAULT 'emitida',
    creado_en                   TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE INDEX idx_compras_company ON compras (company_id);
CREATE INDEX idx_compras_proveedor ON compras (proveedor_id);
CREATE INDEX idx_compras_estado_pago ON compras (estado_pago);

CREATE TABLE detalle_compras (
    id                          BIGSERIAL               PRIMARY KEY,
    compra_id                   BIGINT                  NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
    producto_id                 BIGINT                  NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad                    INTEGER                 NOT NULL CHECK (cantidad > 0),
    precio_unitario_historico   NUMERIC(12,2)           NOT NULL CHECK (precio_unitario_historico >= 0),
    subtotal                    NUMERIC(12,2)           NOT NULL CHECK (subtotal >= 0)
);

CREATE INDEX idx_detalle_compras_compra ON detalle_compras (compra_id);

CREATE TYPE estado_orden_compra AS ENUM ('borrador', 'confirmada', 'recibida', 'cancelada');

CREATE TABLE ordenes_compra (
    id                          BIGSERIAL               PRIMARY KEY,
    company_id                  BIGINT                  NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    usuario_id                  BIGINT                  NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    proveedor_id                BIGINT                  REFERENCES proveedores(id) ON DELETE SET NULL,
    estado                      estado_orden_compra     NOT NULL DEFAULT 'borrador',
    fecha_orden                 TIMESTAMPTZ             NOT NULL DEFAULT now(),
    fecha_entrega_esperada      DATE,
    notas                       TEXT,
    -- Se llena solo al recibir — el puente hacia la compra real.
    compra_id                   BIGINT                  REFERENCES compras(id) ON DELETE SET NULL,
    creado_en                   TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE INDEX idx_ordenes_compra_company ON ordenes_compra (company_id);
CREATE INDEX idx_ordenes_compra_estado ON ordenes_compra (estado);

CREATE TABLE orden_compra_items (
    id                          BIGSERIAL               PRIMARY KEY,
    orden_compra_id             BIGINT                  NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
    producto_id                 BIGINT                  NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad                    INTEGER                 NOT NULL CHECK (cantidad > 0),
    precio_unitario             NUMERIC(12,2)           NOT NULL CHECK (precio_unitario >= 0),
    subtotal                    NUMERIC(12,2)           NOT NULL CHECK (subtotal >= 0)
);

CREATE INDEX idx_orden_compra_items_orden ON orden_compra_items (orden_compra_id);

COMMIT;
