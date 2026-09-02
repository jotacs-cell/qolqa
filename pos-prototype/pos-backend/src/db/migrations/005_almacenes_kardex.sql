-- =====================================================================
-- Migración 005: almacenes + kardex
-- =====================================================================
-- Fase 5 del roadmap (Inventario): cada empresa puede tener varios
-- almacenes/locales (confirmado por el cliente: "cada usuario que
-- contrate un plan puede tener varios almacenes"), y todo movimiento de
-- stock queda registrado en el kardex — "el stock siempre reconstruible
-- desde el kardex" es el entregable clave de esta fase.
--
-- Diseño elegido para no romper nada de lo ya construido (ventas,
-- cotizaciones, pedidos, ajustes de stock): productos.stock y
-- productos.stock_reservado SIGUEN existiendo como el TOTAL de la
-- empresa (suma de todos sus almacenes) — todo el código que ya lee/
-- escribe esos campos (ventas.service.js, pedidos.controller.js, el
-- buscador de producto, etc.) sigue funcionando exactamente igual. Lo
-- nuevo es el detalle POR almacén (producto_stock) y el historial
-- (kardex_movimientos), que se actualizan EN PARALELO cada vez que se
-- toca productos.stock — nunca se toca stock sin su movimiento.
--
-- Todo lo existente se migra a un "Almacén principal" por empresa, para
-- no perder ningún dato.
-- =====================================================================

BEGIN;

CREATE TABLE almacenes (
    id              BIGSERIAL           PRIMARY KEY,
    company_id      BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre          VARCHAR(150)        NOT NULL,
    direccion       VARCHAR(300),
    es_principal    BOOLEAN             NOT NULL DEFAULT false,
    activo          BOOLEAN             NOT NULL DEFAULT true,
    creado_en       TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_almacenes_company ON almacenes (company_id);
-- Cada empresa tiene EXACTAMENTE un almacén principal (destino por
-- defecto de ventas/ajustes existentes, que todavía no eligen almacén).
CREATE UNIQUE INDEX idx_almacenes_principal_unico ON almacenes (company_id) WHERE es_principal;

CREATE TABLE producto_stock (
    id              BIGSERIAL           PRIMARY KEY,
    producto_id     BIGINT              NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    almacen_id      BIGINT              NOT NULL REFERENCES almacenes(id) ON DELETE CASCADE,
    stock           INTEGER             NOT NULL DEFAULT 0 CHECK (stock >= 0),
    stock_reservado INTEGER             NOT NULL DEFAULT 0 CHECK (stock_reservado >= 0),
    UNIQUE (producto_id, almacen_id)
);

CREATE INDEX idx_producto_stock_producto ON producto_stock (producto_id);
CREATE INDEX idx_producto_stock_almacen ON producto_stock (almacen_id);

CREATE TYPE tipo_movimiento_kardex AS ENUM (
    'entrada', 'salida', 'ajuste_positivo', 'ajuste_negativo',
    'transferencia_salida', 'transferencia_entrada'
);

CREATE TABLE kardex_movimientos (
    id                  BIGSERIAL               PRIMARY KEY,
    company_id          BIGINT                  NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    producto_id         BIGINT                  NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    almacen_id          BIGINT                  NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
    tipo                tipo_movimiento_kardex  NOT NULL,
    -- Siempre positivo — el signo/dirección lo da `tipo`, no el número.
    cantidad            INTEGER                 NOT NULL CHECK (cantidad > 0),
    -- Snapshot del stock de ESE almacén justo después del movimiento —
    -- así el histórico se lee directo, sin tener que sumar todo desde el
    -- principio cada vez.
    stock_resultante    INTEGER                 NOT NULL,
    motivo              VARCHAR(300),
    -- De dónde vino el movimiento (venta, pedido, nota de crédito, ajuste
    -- manual, transferencia) — trazabilidad sin acoplar el kardex a cada
    -- tabla de origen con una FK distinta.
    referencia_tipo     VARCHAR(30),
    referencia_id       BIGINT,
    usuario_id          BIGINT                  NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    creado_en           TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE INDEX idx_kardex_producto_almacen ON kardex_movimientos (producto_id, almacen_id, creado_en);
CREATE INDEX idx_kardex_company ON kardex_movimientos (company_id);

-- ---------------------------------------------------------------------
-- Migrar lo existente: un almacén principal por empresa, con el stock
-- actual de cada producto volcado ahí tal cual.
-- ---------------------------------------------------------------------
INSERT INTO almacenes (company_id, nombre, es_principal, activo)
SELECT id, 'Almacén principal', true, true FROM empresas;

INSERT INTO producto_stock (producto_id, almacen_id, stock, stock_reservado)
SELECT p.id, a.id, p.stock, p.stock_reservado
  FROM productos p
  JOIN almacenes a ON a.company_id = p.company_id AND a.es_principal;

COMMIT;
