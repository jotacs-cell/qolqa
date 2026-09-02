-- =====================================================================
-- Migración 012: Métodos de pago (Fase 7 del roadmap del dashboard)
-- =====================================================================
-- Cuentas bancarias propias del negocio (para que el cliente sepa dónde
-- depositar/transferir), un número de Yape/Plin, y un límite de crédito
-- por cliente — para que "vender a crédito" (ya existente desde Fase 4,
-- ventas.estado_pago) tenga un tope configurable en vez de ser ilimitado.
-- =====================================================================

BEGIN;

CREATE TABLE cuentas_bancarias (
    id            BIGSERIAL PRIMARY KEY,
    company_id    BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    banco         VARCHAR(80)         NOT NULL,
    titular       VARCHAR(150)        NOT NULL,
    numero_cuenta VARCHAR(40)         NOT NULL,
    tipo_cuenta   VARCHAR(20)         NOT NULL DEFAULT 'ahorro' CHECK (tipo_cuenta IN ('ahorro', 'corriente', 'cci')),
    moneda        VARCHAR(3)          NOT NULL DEFAULT 'PEN' CHECK (moneda IN ('PEN', 'USD')),
    activa        BOOLEAN             NOT NULL DEFAULT true,
    creado_en     TIMESTAMPTZ         NOT NULL DEFAULT now()
);
CREATE INDEX idx_cuentas_bancarias_company ON cuentas_bancarias (company_id);

ALTER TABLE empresas ADD COLUMN yape_plin_numero VARCHAR(20);

-- Tope de deuda permitido por cliente al vender "a crédito" (fiado). 0 =
-- sin crédito habilitado (comportamiento actual, no cambia nada para
-- quien no lo configure). Se valida en el frontend contra el saldo
-- pendiente ya cargado (ventas con estado_pago = 'pendiente') — no
-- requiere un endpoint nuevo de solo-lectura.
ALTER TABLE clientes ADD COLUMN limite_credito NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (limite_credito >= 0);

COMMIT;
