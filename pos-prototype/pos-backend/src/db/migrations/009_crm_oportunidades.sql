-- =====================================================================
-- Migración 009: CRM — pipeline de oportunidades (Fase 9)
-- =====================================================================
-- Toda oportunidad cuelga de un cliente YA EXISTENTE (confirmado con el
-- cliente) — no hay "prospecto suelto" sin cliente formal; si todavía no
-- es cliente, primero se crea como cliente (flujo ya construido en
-- clientes.controller.js).
--
-- Al llegar a "propuesta" (o cualquier etapa activa) se puede generar una
-- Cotización real desde la oportunidad — reutiliza cotizaciones.
-- controller.js#crear tal cual, sin duplicar lógica; solo se guarda el
-- vínculo (cotizacion_id) para trazabilidad.
-- =====================================================================

BEGIN;

CREATE TYPE etapa_oportunidad AS ENUM ('prospecto', 'contactado', 'propuesta', 'negociacion', 'ganada', 'perdida');

CREATE TABLE oportunidades (
    id                      BIGSERIAL           PRIMARY KEY,
    company_id              BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id              BIGINT              NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    usuario_id              BIGINT              NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    titulo                  VARCHAR(200)        NOT NULL,
    etapa                   etapa_oportunidad   NOT NULL DEFAULT 'prospecto',
    monto_estimado          NUMERIC(12,2)       CHECK (monto_estimado >= 0),
    fecha_cierre_esperada   DATE,
    motivo_perdida          VARCHAR(300),
    -- Se llena cuando se genera una cotización real desde la oportunidad
    -- (ver oportunidades.controller.js#generarCotizacion).
    cotizacion_id           BIGINT              REFERENCES cotizaciones(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ         NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_oportunidades_company ON oportunidades (company_id);
CREATE INDEX idx_oportunidades_etapa ON oportunidades (etapa);
CREATE INDEX idx_oportunidades_cliente ON oportunidades (cliente_id);

-- El "seguimiento" propiamente dicho: notas/llamadas/reuniones colgadas
-- de una oportunidad — el historial que justifica por qué está en la
-- etapa en la que está.
CREATE TABLE oportunidad_actividades (
    id                      BIGSERIAL           PRIMARY KEY,
    oportunidad_id          BIGINT              NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
    tipo                    VARCHAR(20)         NOT NULL DEFAULT 'nota',
    descripcion             TEXT                NOT NULL,
    usuario_id              BIGINT              NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    creado_en               TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_oportunidad_actividades_oportunidad ON oportunidad_actividades (oportunidad_id);

COMMIT;
