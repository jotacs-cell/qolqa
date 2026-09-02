-- =====================================================================
-- Sistema POS - Esquema de Base de Datos (PostgreSQL)
-- =====================================================================
-- Núcleo relacional: usuarios, productos, ventas, detalle_ventas
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Extensiones útiles (UUID opcional; se usa BIGSERIAL por defecto)
-- ---------------------------------------------------------------------
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- descomentar si se prefiere UUID

-- ---------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------
CREATE TYPE rol_usuario AS ENUM ('admin', 'supervisor', 'cajero');
CREATE TYPE estado_producto AS ENUM ('activo', 'inactivo', 'descontinuado');
CREATE TYPE metodo_pago_venta AS ENUM ('efectivo', 'tarjeta', 'yape', 'plin', 'transferencia', 'mixto');
CREATE TYPE estado_documento_venta AS ENUM ('emitida', 'anulada', 'pendiente');

-- ---------------------------------------------------------------------
-- Tabla: usuarios
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
    id              BIGSERIAL PRIMARY KEY,
    nombre          VARCHAR(120)        NOT NULL,
    email           VARCHAR(150)        NOT NULL UNIQUE,
    password_hash   VARCHAR(255)        NOT NULL,
    rol             rol_usuario         NOT NULL DEFAULT 'cajero',
    activo          BOOLEAN             NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ         NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_usuarios_rol ON usuarios (rol);

-- ---------------------------------------------------------------------
-- Tabla: productos
-- ---------------------------------------------------------------------
CREATE TABLE productos (
    id              BIGSERIAL PRIMARY KEY,
    codigo_barras   VARCHAR(64)         NOT NULL UNIQUE,
    nombre          VARCHAR(200)        NOT NULL,
    descripcion     TEXT,
    precio_compra   NUMERIC(12,2)       NOT NULL CHECK (precio_compra >= 0),
    precio_venta    NUMERIC(12,2)       NOT NULL CHECK (precio_venta >= 0),
    stock           INTEGER             NOT NULL DEFAULT 0 CHECK (stock >= 0),
    estado          estado_producto     NOT NULL DEFAULT 'activo',
    creado_en       TIMESTAMPTZ         NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ         NOT NULL DEFAULT now(),

    CONSTRAINT chk_margen_valido CHECK (precio_venta >= precio_compra)
);

CREATE INDEX idx_productos_codigo_barras ON productos (codigo_barras);
CREATE INDEX idx_productos_nombre ON productos USING gin (to_tsvector('spanish', nombre));
CREATE INDEX idx_productos_estado ON productos (estado);

-- ---------------------------------------------------------------------
-- Tabla: clientes (referenciada por ventas.cliente_id)
-- ---------------------------------------------------------------------
CREATE TABLE clientes (
    id              BIGSERIAL PRIMARY KEY,
    nombre          VARCHAR(150)        NOT NULL,
    documento       VARCHAR(20)         UNIQUE,
    telefono        VARCHAR(20),
    email           VARCHAR(150),
    creado_en       TIMESTAMPTZ         NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Tabla: ventas (cabecera inmutable)
-- ---------------------------------------------------------------------
CREATE TABLE ventas (
    id                  BIGSERIAL PRIMARY KEY,
    usuario_id          BIGINT              NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    cliente_id          BIGINT              REFERENCES clientes(id) ON DELETE SET NULL,
    fecha               TIMESTAMPTZ         NOT NULL DEFAULT now(),
    total               NUMERIC(12,2)       NOT NULL CHECK (total >= 0),
    metodo_pago         metodo_pago_venta   NOT NULL,
    estado_documento    estado_documento_venta NOT NULL DEFAULT 'emitida'
);

CREATE INDEX idx_ventas_fecha ON ventas (fecha);
CREATE INDEX idx_ventas_usuario_id ON ventas (usuario_id);
CREATE INDEX idx_ventas_cliente_id ON ventas (cliente_id);
CREATE INDEX idx_ventas_estado_documento ON ventas (estado_documento);

-- ---------------------------------------------------------------------
-- Tabla: detalle_ventas (líneas de venta, precio histórico congelado)
-- ---------------------------------------------------------------------
CREATE TABLE detalle_ventas (
    id                          BIGSERIAL PRIMARY KEY,
    venta_id                    BIGINT          NOT NULL REFERENCES ventas(id) ON DELETE RESTRICT,
    producto_id                 BIGINT          NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad                    INTEGER         NOT NULL CHECK (cantidad > 0),
    precio_unitario_historico   NUMERIC(12,2)   NOT NULL CHECK (precio_unitario_historico >= 0),
    subtotal                    NUMERIC(12,2)   NOT NULL CHECK (subtotal >= 0),

    CONSTRAINT chk_subtotal_coherente CHECK (subtotal = cantidad * precio_unitario_historico)
);

CREATE INDEX idx_detalle_ventas_venta_id ON detalle_ventas (venta_id);
CREATE INDEX idx_detalle_ventas_producto_id ON detalle_ventas (producto_id);

-- ---------------------------------------------------------------------
-- Trigger genérico: actualizar "actualizado_en" en cada UPDATE
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_usuarios_actualizado
    BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

CREATE TRIGGER trg_productos_actualizado
    BEFORE UPDATE ON productos
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

COMMIT;

-- =====================================================================
-- Notas de diseño
-- =====================================================================
-- 1. "detalle_ventas" nunca se debe UPDATE en precio_unitario_historico:
--    esa columna congela el precio al momento de la venta, aunque
--    "productos.precio_venta" cambie después.
--
-- 2. ON DELETE RESTRICT en ventas->usuarios y detalle_ventas->ventas/productos
--    protege el historial de transacciones: nunca se puede borrar un
--    usuario o producto que ya tenga ventas asociadas. Para "eliminar"
--    un producto se usa productos.estado = 'inactivo' (soft delete),
--    nunca DELETE.
--
-- 3. El motor de transacciones (Fase 5) debe, dentro de una sola
--    transacción SQL (BEGIN...COMMIT):
--      a) INSERT en ventas (cabecera)
--      b) INSERT masivo en detalle_ventas (líneas)
--      c) UPDATE productos SET stock = stock - cantidad ...
--         (el CHECK stock >= 0 hace fallar automáticamente el UPDATE
--         si no hay stock suficiente, forzando el ROLLBACK)
--
-- 4. Los ENUMs (rol_usuario, estado_producto, etc.) evitan strings
--    libres en columnas de estado, protegiendo la integridad de datos
--    a nivel de base de datos, no solo a nivel de aplicación.
