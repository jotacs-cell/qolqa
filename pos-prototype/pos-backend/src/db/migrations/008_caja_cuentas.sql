-- =====================================================================
-- Migración 008: Caja (Fase 7) + cuentas por cobrar/pagar
-- =====================================================================
-- Caja: un turno por almacén a la vez (el índice único parcial es lo que
-- previene la condición de carrera de aperturas/cierres concurrentes por
-- sucursal — el riesgo principal de esta fase). Al cerrar, se calcula
-- monto_esperado = monto_inicial + ventas en efectivo del turno +
-- ingresos manuales - egresos manuales, y diferencia = monto_contado -
-- monto_esperado — el arqueo con diferencia explícita que pide el
-- roadmap.
--
-- Cuentas por cobrar/pagar: compras ya tenía estado_pago (Fase 6); se
-- agrega el mismo campo, simétrico, a ventas — una venta puede quedar
-- "fiada" (a crédito) en vez de cobrada al momento.
-- =====================================================================

BEGIN;

CREATE TYPE estado_turno_caja AS ENUM ('abierto', 'cerrado');
CREATE TYPE tipo_movimiento_caja AS ENUM ('ingreso', 'egreso');

CREATE TABLE turnos_caja (
    id                      BIGSERIAL           PRIMARY KEY,
    company_id              BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    almacen_id              BIGINT              NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
    usuario_apertura_id     BIGINT              NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    usuario_cierre_id       BIGINT              REFERENCES usuarios(id) ON DELETE RESTRICT,
    estado                  estado_turno_caja   NOT NULL DEFAULT 'abierto',
    monto_inicial           NUMERIC(12,2)       NOT NULL CHECK (monto_inicial >= 0),
    monto_contado           NUMERIC(12,2),
    monto_esperado          NUMERIC(12,2),
    diferencia              NUMERIC(12,2),
    fecha_apertura          TIMESTAMPTZ         NOT NULL DEFAULT now(),
    fecha_cierre            TIMESTAMPTZ,
    notas_apertura          TEXT,
    notas_cierre            TEXT
);

CREATE INDEX idx_turnos_caja_company ON turnos_caja (company_id);
CREATE UNIQUE INDEX idx_turnos_caja_abierto_unico ON turnos_caja (almacen_id) WHERE estado = 'abierto';

CREATE TABLE movimientos_caja (
    id                      BIGSERIAL           PRIMARY KEY,
    turno_caja_id           BIGINT              NOT NULL REFERENCES turnos_caja(id) ON DELETE CASCADE,
    tipo                    tipo_movimiento_caja NOT NULL,
    monto                   NUMERIC(12,2)       NOT NULL CHECK (monto > 0),
    motivo                  VARCHAR(300)        NOT NULL,
    usuario_id              BIGINT              NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    creado_en               TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_movimientos_caja_turno ON movimientos_caja (turno_caja_id);

-- Nullable: una venta hecha sin caja abierta sigue funcionando igual que
-- hasta ahora, simplemente no entra en ningún arqueo.
ALTER TABLE ventas ADD COLUMN turno_caja_id BIGINT REFERENCES turnos_caja(id) ON DELETE SET NULL;

-- Cuentas por cobrar: mismo patrón que compras.estado_pago (Fase 6).
ALTER TABLE ventas ADD COLUMN estado_pago estado_pago_compra NOT NULL DEFAULT 'pagada';
CREATE INDEX idx_ventas_estado_pago ON ventas (estado_pago);

COMMIT;
