-- =====================================================================
-- Migración 001: multiempresa
-- =====================================================================
-- Aditiva a propósito: esta base ya tenía datos reales de demo (ventas,
-- productos, usuarios) cuando se decidió hacer el sistema multiempresa.
-- En vez de recrear el esquema desde schema.sql (que hubiera borrado esos
-- datos), esta migración agrega `empresas` y `company_id` sin tocar una
-- sola fila existente: todo lo que ya había queda asignado a la empresa
-- que hoy vive en `empresa_emisora` (la única que existe hasta ahora).
--
-- Un DB nuevo (instalación desde cero) no necesita correr esto — ya nace
-- con la forma final directamente desde schema.sql.
-- =====================================================================

BEGIN;

CREATE TABLE empresas (
    id                  BIGSERIAL           PRIMARY KEY,
    ruc                 CHAR(11)            NOT NULL UNIQUE,
    razon_social        VARCHAR(200)        NOT NULL,
    nombre_comercial    VARCHAR(200),
    ubigeo              CHAR(6)             NOT NULL,
    direccion           VARCHAR(255)        NOT NULL,
    ambiente            VARCHAR(10)         NOT NULL DEFAULT 'beta' CHECK (ambiente IN ('beta','produccion')),
    activa              BOOLEAN             NOT NULL DEFAULT TRUE,
    -- Credenciales NubeFacT por empresa. Se administran SOLO desde el
    -- panel de Super Admin (qolqa-landing/src/SuperAdmin.tsx vía un
    -- endpoint proxy en qolqa-backend) — el dueño de cada empresa nunca
    -- las ve ni las edita. NULL = todavía no configurado; el envío a
    -- SUNAT queda en estado_sunat = 'error_envio' hasta que se llenen.
    nubefact_ruta       VARCHAR(255),
    nubefact_token      VARCHAR(255),
    creado_en           TIMESTAMPTZ         NOT NULL DEFAULT now()
);

INSERT INTO empresas (ruc, razon_social, nombre_comercial, ubigeo, direccion, ambiente)
SELECT ruc, razon_social, nombre_comercial, ubigeo, direccion, ambiente
FROM empresa_emisora WHERE id = 1;

-- A partir de aquí, EMPRESA_ID = el id que acaba de tomar esa fila.
-- Como es la primera fila insertada en una tabla BIGSERIAL recién creada,
-- siempre es 1 — pero lo resolvemos por RUC para no depender de eso.

ALTER TABLE sucursales ADD COLUMN company_id BIGINT REFERENCES empresas(id) ON DELETE CASCADE;
UPDATE sucursales SET company_id = (SELECT id FROM empresas WHERE ruc = '20123456789');
ALTER TABLE sucursales ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE sucursales DROP CONSTRAINT sucursales_nombre_key;
ALTER TABLE sucursales ADD CONSTRAINT sucursales_company_nombre_key UNIQUE (company_id, nombre);

ALTER TABLE usuarios ADD COLUMN company_id BIGINT REFERENCES empresas(id) ON DELETE CASCADE;
UPDATE usuarios SET company_id = (SELECT id FROM empresas WHERE ruc = '20123456789');
ALTER TABLE usuarios ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_usuarios_company ON usuarios (company_id);

ALTER TABLE auditoria ADD COLUMN company_id BIGINT REFERENCES empresas(id) ON DELETE CASCADE;
UPDATE auditoria SET company_id = (SELECT id FROM empresas WHERE ruc = '20123456789');
ALTER TABLE auditoria ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_auditoria_company ON auditoria (company_id);

ALTER TABLE productos ADD COLUMN company_id BIGINT REFERENCES empresas(id) ON DELETE CASCADE;
UPDATE productos SET company_id = (SELECT id FROM empresas WHERE ruc = '20123456789');
ALTER TABLE productos ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE productos DROP CONSTRAINT productos_codigo_barras_key;
ALTER TABLE productos ADD CONSTRAINT productos_company_codigo_barras_key UNIQUE (company_id, codigo_barras);
CREATE INDEX idx_productos_company ON productos (company_id);

ALTER TABLE clientes ADD COLUMN company_id BIGINT REFERENCES empresas(id) ON DELETE CASCADE;
UPDATE clientes SET company_id = (SELECT id FROM empresas WHERE ruc = '20123456789');
ALTER TABLE clientes ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE clientes DROP CONSTRAINT clientes_numero_documento_key;
ALTER TABLE clientes ADD CONSTRAINT clientes_company_numero_documento_key UNIQUE (company_id, numero_documento);
CREATE INDEX idx_clientes_company ON clientes (company_id);

ALTER TABLE ventas ADD COLUMN company_id BIGINT REFERENCES empresas(id) ON DELETE CASCADE;
UPDATE ventas SET company_id = (SELECT id FROM empresas WHERE ruc = '20123456789');
ALTER TABLE ventas ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_ventas_company ON ventas (company_id);

ALTER TABLE series_comprobantes ADD COLUMN company_id BIGINT REFERENCES empresas(id) ON DELETE CASCADE;
UPDATE series_comprobantes SET company_id = (SELECT id FROM empresas WHERE ruc = '20123456789');
ALTER TABLE series_comprobantes ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE series_comprobantes DROP CONSTRAINT series_comprobantes_tipo_comprobante_serie_key;
ALTER TABLE series_comprobantes ADD CONSTRAINT series_company_tipo_serie_key UNIQUE (company_id, tipo_comprobante, serie);
CREATE INDEX idx_series_company ON series_comprobantes (company_id);

ALTER TABLE comprobantes_electronicos ADD COLUMN company_id BIGINT REFERENCES empresas(id) ON DELETE CASCADE;
UPDATE comprobantes_electronicos SET company_id = (SELECT id FROM empresas WHERE ruc = '20123456789');
ALTER TABLE comprobantes_electronicos ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE comprobantes_electronicos DROP CONSTRAINT comprobantes_electronicos_tipo_comprobante_serie_correlativ_key;
ALTER TABLE comprobantes_electronicos ADD CONSTRAINT comprobantes_company_tipo_serie_correlativo_key UNIQUE (company_id, tipo_comprobante, serie, correlativo);
CREATE INDEX idx_comprobantes_company ON comprobantes_electronicos (company_id);

DROP TABLE empresa_emisora;

COMMIT;
