-- =====================================================================
-- Sistema de Ventas Web + Facturación Electrónica SUNAT
-- Esquema completo de base de datos (PostgreSQL)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------
-- admin: acceso total. vendedor: emite boleta/factura, no anula. cajero: emite
-- boleta/recibo en el mostrador, no factura ni anulaciones. contador: anula,
-- emite notas de crédito y ve reportes — no vende ni gestiona productos.
CREATE TYPE rol_usuario AS ENUM ('admin', 'vendedor', 'cajero', 'contador');
CREATE TYPE estado_producto AS ENUM ('activo', 'inactivo', 'descontinuado');
CREATE TYPE metodo_pago_venta AS ENUM ('efectivo', 'tarjeta', 'yape', 'plin', 'transferencia', 'mixto');
CREATE TYPE estado_documento_venta AS ENUM ('emitida', 'anulada', 'pendiente');

-- Catálogo SUNAT 06: tipo de documento de identidad del receptor
CREATE TYPE tipo_documento_cliente AS ENUM ('sin_documento', 'dni', 'ruc', 'ce', 'pasaporte');

-- Catálogo SUNAT 01: tipo de comprobante de pago electrónico
CREATE TYPE tipo_comprobante_electronico AS ENUM ('factura', 'boleta', 'nota_credito', 'nota_debito');

CREATE TYPE estado_cotizacion AS ENUM ('borrador', 'enviada', 'confirmada', 'vencida', 'rechazada');

-- Estado del comprobante frente a SUNAT/OSE
CREATE TYPE estado_sunat_comprobante AS ENUM (
    'pendiente',                 -- generado, aún no enviado
    'enviado',                   -- enviado al OSE/SUNAT, esperando respuesta
    'aceptado',
    'aceptado_con_observaciones',
    'rechazado',
    'error_envio',                -- fallo de red/timeout, reintentable
    'anulado'                     -- de baja mediante comunicación de baja
);

-- ---------------------------------------------------------------------
-- empresas — cada negocio que usa el sistema. TODO lo demás cuelga de
-- aquí por company_id: dos empresas nunca comparten usuarios, productos
-- ni ventas. No hay concepto de "una cuenta, varias empresas" en este
-- backend — cada empresa tiene su propio login, punto.
-- ---------------------------------------------------------------------
CREATE TABLE empresas (
    id                  BIGSERIAL           PRIMARY KEY,
    ruc                 CHAR(11)            NOT NULL UNIQUE,
    razon_social        VARCHAR(200)        NOT NULL,
    nombre_comercial    VARCHAR(200),
    ubigeo              CHAR(6)             NOT NULL,   -- catálogo SUNAT de ubigeos
    direccion           VARCHAR(255)        NOT NULL,
    ambiente            VARCHAR(10)         NOT NULL DEFAULT 'beta' CHECK (ambiente IN ('beta','produccion')),
    activa              BOOLEAN             NOT NULL DEFAULT TRUE,
    creado_en           TIMESTAMPTZ         NOT NULL DEFAULT now(),
    -- Credenciales del proveedor de facturación electrónica (NubeFacT) —
    -- las configura Super Admin por empresa (ver admin.controller.js
    -- obtenerNubefact/actualizarNubefact). Esta columna estaba solo en
    -- migrations/001_multiempresa.sql y nunca se aplicó de verdad en
    -- producción (la tabla real se creó desde este schema.sql, que nunca
    -- las tuvo) — por eso configurar NubeFacT daba error 500 silencioso.
    nubefact_ruta       VARCHAR(255),
    nubefact_token      VARCHAR(255)
);

-- ---------------------------------------------------------------------
-- sucursales — mínimo necesario para asignar un usuario y una venta a un
-- local. OJO: esto NO implementa stock por sucursal (los productos siguen
-- siendo un catálogo único) — solo identifica quién vendió dónde. Aislar
-- inventario y reportes por sucursal es un cambio más grande, pendiente
-- (ver README).
-- ---------------------------------------------------------------------
CREATE TABLE sucursales (
    id          BIGSERIAL PRIMARY KEY,
    company_id  BIGINT       NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre      VARCHAR(120) NOT NULL,
    activa      BOOLEAN      NOT NULL DEFAULT TRUE,

    UNIQUE (company_id, nombre)
);

CREATE TABLE usuarios (
    id              BIGSERIAL PRIMARY KEY,
    company_id      BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre          VARCHAR(120)        NOT NULL,
    email           VARCHAR(150)        NOT NULL UNIQUE, -- único en todo el sistema: el login no pide "empresa", solo correo+contraseña
    password_hash   VARCHAR(255)        NOT NULL,
    rol             rol_usuario         NOT NULL DEFAULT 'cajero',
    sucursal_id     BIGINT              REFERENCES sucursales(id) ON DELETE SET NULL,
    activo          BOOLEAN             NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ         NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_usuarios_rol ON usuarios (rol);
CREATE INDEX idx_usuarios_company ON usuarios (company_id);

-- ---------------------------------------------------------------------
-- sesiones — una fila por login. Permite listar "dónde tengo sesión
-- abierta" y revocar una sesión puntual (control de sesiones) sin
-- esperar a que el JWT expire por su cuenta.
-- ---------------------------------------------------------------------
CREATE TABLE sesiones (
    id            BIGSERIAL PRIMARY KEY,
    usuario_id    BIGINT       NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    jti           UUID         NOT NULL UNIQUE, -- claim "jti" del JWT emitido en el login
    dispositivo   VARCHAR(200),                 -- User-Agent, informativo
    ip            VARCHAR(45),
    creado_en     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ultimo_uso_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    revocada_en   TIMESTAMPTZ
);

CREATE INDEX idx_sesiones_usuario ON sesiones (usuario_id);

-- ---------------------------------------------------------------------
-- auditoria — historial de acciones sensibles (quién hizo qué y cuándo).
-- Se inserta desde los controllers/servicios que mutan datos, nunca se
-- edita ni se borra después.
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
    id          BIGSERIAL PRIMARY KEY,
    company_id  BIGINT       NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    usuario_id  BIGINT       REFERENCES usuarios(id) ON DELETE SET NULL,
    accion      VARCHAR(80)  NOT NULL,   -- ej. 'venta.anular', 'producto.crear'
    entidad     VARCHAR(40),             -- ej. 'venta', 'producto', 'usuario'
    entidad_id  BIGINT,
    detalle     JSONB,
    creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_auditoria_usuario ON auditoria (usuario_id);
CREATE INDEX idx_auditoria_creado ON auditoria (creado_en DESC);
CREATE INDEX idx_auditoria_company ON auditoria (company_id);

-- Personalización por empresa de la matriz de permisos (config/permisos.js).
-- Si una empresa no tiene fila para una `accion`, se usa el default global
-- de PERMISOS — esta tabla solo guarda las excepciones, no toda la matriz
-- repetida por cada empresa. Gestionado desde Super Admin (ver
-- admin.controller.js#obtenerPermisosEmpresa/actualizarPermisoEmpresa).
CREATE TABLE permisos_empresa (
    company_id      BIGINT       NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    accion          VARCHAR(50)  NOT NULL,
    roles           TEXT[]       NOT NULL,
    actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, accion)
);

-- ---------------------------------------------------------------------
-- productos
-- ---------------------------------------------------------------------
CREATE TABLE productos (
    id              BIGSERIAL PRIMARY KEY,
    company_id      BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    -- Nulo para negocios de servicios (restaurantes, salones, talleres,
    -- hoteles) que no tienen nada que escanear — el producto/servicio se
    -- busca por nombre. Único POR EMPRESA (no global): dos empresas
    -- pueden vender productos con el mismo código de barras sin chocar.
    codigo_barras   VARCHAR(64),
    nombre          VARCHAR(200)        NOT NULL,
    descripcion     TEXT,
    precio_compra   NUMERIC(12,2)       NOT NULL CHECK (precio_compra >= 0),
    precio_venta    NUMERIC(12,2)       NOT NULL CHECK (precio_venta >= 0),
    stock           INTEGER             NOT NULL DEFAULT 0 CHECK (stock >= 0),
    -- Comprometido en pedidos "confirmado" sin facturar todavía — lo
    -- realmente disponible para vender es stock - stock_reservado (ver
    -- migración 004 y pedidos.controller.js).
    stock_reservado INTEGER             NOT NULL DEFAULT 0 CHECK (stock_reservado >= 0),
    -- Catálogo SUNAT 07: afectación al IGV. 10 = gravado - operación onerosa (el más común)
    codigo_afectacion_igv VARCHAR(2)    NOT NULL DEFAULT '10',
    unidad_medida   VARCHAR(3)          NOT NULL DEFAULT 'NIU', -- catálogo SUNAT 03 (NIU = unidad)
    estado          estado_producto     NOT NULL DEFAULT 'activo',
    creado_en       TIMESTAMPTZ         NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ         NOT NULL DEFAULT now(),

    CONSTRAINT chk_margen_valido CHECK (precio_venta >= precio_compra),
    UNIQUE (company_id, codigo_barras)
);

CREATE INDEX idx_productos_codigo_barras ON productos (codigo_barras);
CREATE INDEX idx_productos_estado ON productos (estado);
CREATE INDEX idx_productos_company ON productos (company_id);

-- ---------------------------------------------------------------------
-- clientes
-- ---------------------------------------------------------------------
CREATE TABLE clientes (
    id                      BIGSERIAL PRIMARY KEY,
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

CREATE INDEX idx_clientes_company ON clientes (company_id);

-- ---------------------------------------------------------------------
-- Compras (Fase 6) — simétrico a clientes/ventas/pedidos de arriba.
-- Una compra NO emite ningún documento propio ante SUNAT (lo emite el
-- proveedor); solo se guarda su número de referencia para contabilidad.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- ventas (cabecera inmutable)
-- ---------------------------------------------------------------------
CREATE TABLE ventas (
    id                  BIGSERIAL PRIMARY KEY,
    company_id          BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
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
-- El listado de ventas (ventas.controller.js#listar) siempre filtra por
-- company_id Y ordena por fecha DESC a la vez — con pocas empresas de
-- prueba no se nota, pero es la tabla de mayor volumen del sistema (una
-- fila por cada venta, de todas las empresas), así que a más empresas y
-- más historial, sin este índice compuesto Postgres termina recorriendo
-- filas de más para armar cada página de resultados.
CREATE INDEX idx_ventas_company_fecha ON ventas (company_id, fecha DESC);

-- ---------------------------------------------------------------------
-- detalle_ventas (líneas, precio histórico congelado)
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

-- Línea de tiempo de notas manuales sobre una venta/comprobante — ver
-- migración 013_notas_venta.sql para la nota completa.
CREATE TABLE notas_venta (
    id          BIGSERIAL PRIMARY KEY,
    venta_id    BIGINT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    usuario_id  BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    texto       TEXT NOT NULL,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notas_venta_venta_id ON notas_venta (venta_id);

-- ---------------------------------------------------------------------
-- cotizaciones — una venta que todavía no se confirma: no descuenta
-- stock, no reserva serie/correlativo SUNAT, no genera comprobante. Al
-- confirmar, se llama a la MISMA lógica de registrar una venta (con estas
-- líneas) — ver services/ventas.service.js y controllers/cotizaciones.
-- controller.js#confirmar. venta_id queda NULL hasta que eso pasa.
-- ---------------------------------------------------------------------
CREATE TABLE cotizaciones (
    id                  BIGSERIAL           PRIMARY KEY,
    company_id          BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    usuario_id          BIGINT              NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    cliente_id          BIGINT              REFERENCES clientes(id) ON DELETE SET NULL,
    estado              estado_cotizacion   NOT NULL DEFAULT 'borrador',
    fecha_cotizacion    TIMESTAMPTZ         NOT NULL DEFAULT now(),
    fecha_vencimiento   DATE,
    notas               TEXT,
    venta_id            BIGINT              REFERENCES ventas(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_cotizaciones_company ON cotizaciones (company_id);
CREATE INDEX idx_cotizaciones_estado ON cotizaciones (estado);

CREATE TABLE cotizacion_items (
    id                  BIGSERIAL           PRIMARY KEY,
    cotizacion_id       BIGINT              NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    producto_id         BIGINT              NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad            INTEGER             NOT NULL CHECK (cantidad > 0),
    precio_unitario     NUMERIC(12,2)       NOT NULL CHECK (precio_unitario >= 0),
    descuento_pct       NUMERIC(5,2)        NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
    subtotal            NUMERIC(12,2)       NOT NULL CHECK (subtotal >= 0)
);

CREATE INDEX idx_cotizacion_items_cotizacion ON cotizacion_items (cotizacion_id);

-- ---------------------------------------------------------------------
-- pedidos — el paso firme entre la cotización aceptada y la factura: a
-- diferencia de la cotización, SÍ reserva stock (productos.stock_reservado)
-- al confirmarse, pero solo descuenta stock de verdad y genera comprobante
-- al facturar — mismo patrón que cotizaciones, ver
-- controllers/pedidos.controller.js.
-- ---------------------------------------------------------------------
CREATE TYPE estado_pedido AS ENUM ('borrador', 'confirmado', 'facturado', 'cancelado');

CREATE TABLE pedidos (
    id                  BIGSERIAL           PRIMARY KEY,
    company_id          BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    usuario_id          BIGINT              NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    cliente_id          BIGINT              REFERENCES clientes(id) ON DELETE SET NULL,
    cotizacion_id       BIGINT              REFERENCES cotizaciones(id) ON DELETE SET NULL,
    estado              estado_pedido       NOT NULL DEFAULT 'borrador',
    fecha_pedido        TIMESTAMPTZ         NOT NULL DEFAULT now(),
    fecha_entrega       DATE,
    notas               TEXT,
    venta_id            BIGINT              REFERENCES ventas(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_pedidos_company ON pedidos (company_id);
CREATE INDEX idx_pedidos_estado ON pedidos (estado);

CREATE TABLE pedido_items (
    id                  BIGSERIAL           PRIMARY KEY,
    pedido_id           BIGINT              NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    producto_id         BIGINT              NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad            INTEGER             NOT NULL CHECK (cantidad > 0),
    precio_unitario     NUMERIC(12,2)       NOT NULL CHECK (precio_unitario >= 0),
    descuento_pct       NUMERIC(5,2)        NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
    subtotal            NUMERIC(12,2)       NOT NULL CHECK (subtotal >= 0)
);

CREATE INDEX idx_pedido_items_pedido ON pedido_items (pedido_id);

-- ---------------------------------------------------------------------
-- almacenes + kardex — Fase 5 (Inventario). productos.stock y
-- productos.stock_reservado siguen siendo el TOTAL de la empresa (todo
-- el código de ventas/pedidos/etc. sigue leyendo/escribiendo esos campos
-- sin cambios); producto_stock es el detalle POR almacén, y
-- kardex_movimientos es el historial que hace ese stock reconstruible.
-- Ver migración 005 para el detalle de esta decisión.
-- ---------------------------------------------------------------------
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
    cantidad            INTEGER                 NOT NULL CHECK (cantidad > 0),
    stock_resultante    INTEGER                 NOT NULL,
    motivo              VARCHAR(300),
    referencia_tipo     VARCHAR(30),
    referencia_id       BIGINT,
    usuario_id          BIGINT                  NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    creado_en           TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE INDEX idx_kardex_producto_almacen ON kardex_movimientos (producto_id, almacen_id, creado_en);
CREATE INDEX idx_kardex_company ON kardex_movimientos (company_id);

-- Una transferencia mueve stock de un almacén a otro de la misma empresa
-- — no cambia el total, solo lo redistribuye. Genera dos movimientos de
-- kardex (salida del origen, entrada al destino) con esta fila como
-- referencia común.
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

-- ---------------------------------------------------------------------
-- Caja (Fase 7) — un turno por almacén a la vez (índice único parcial),
-- que es lo que previene aperturas/cierres concurrentes por sucursal.
-- ---------------------------------------------------------------------
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

-- Nullable: una venta hecha sin caja abierta sigue funcionando igual.
ALTER TABLE ventas ADD COLUMN turno_caja_id BIGINT REFERENCES turnos_caja(id) ON DELETE SET NULL;

-- Cuentas por cobrar: mismo patrón que compras.estado_pago (Fase 6).
ALTER TABLE ventas ADD COLUMN estado_pago estado_pago_compra NOT NULL DEFAULT 'pagada';
CREATE INDEX idx_ventas_estado_pago ON ventas (estado_pago);

-- ---------------------------------------------------------------------
-- CRM — pipeline de oportunidades (Fase 9). Toda oportunidad cuelga de
-- un cliente ya existente; al avanzar puede generar una cotización real
-- (mismo cotizaciones.controller.js#crear, solo se guarda el vínculo).
-- ---------------------------------------------------------------------
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
    cotizacion_id           BIGINT              REFERENCES cotizaciones(id) ON DELETE SET NULL,
    creado_en               TIMESTAMPTZ         NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_oportunidades_company ON oportunidades (company_id);
CREATE INDEX idx_oportunidades_etapa ON oportunidades (etapa);
CREATE INDEX idx_oportunidades_cliente ON oportunidades (cliente_id);

CREATE TABLE oportunidad_actividades (
    id                      BIGSERIAL           PRIMARY KEY,
    oportunidad_id          BIGINT              NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
    tipo                    VARCHAR(20)         NOT NULL DEFAULT 'nota',
    descripcion             TEXT                NOT NULL,
    usuario_id              BIGINT              NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    creado_en               TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_oportunidad_actividades_oportunidad ON oportunidad_actividades (oportunidad_id);

-- ---------------------------------------------------------------------
-- Multi-almacén real en ventas y pedidos (Fase 10) — de qué almacén sale
-- la mercadería, en vez de asumir siempre el principal. La reserva de un
-- pedido "confirmado" vive en producto_stock.stock_reservado (por
-- almacén), no solo en el total de la empresa.
-- ---------------------------------------------------------------------
ALTER TABLE ventas ADD COLUMN almacen_id BIGINT NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT;
ALTER TABLE pedidos ADD COLUMN almacen_id BIGINT NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT;

CREATE INDEX idx_ventas_almacen ON ventas (almacen_id);
CREATE INDEX idx_pedidos_almacen ON pedidos (almacen_id);

-- =====================================================================
-- Catálogo virtual público (solo lectura, sin carrito) — cada empresa
-- puede activar una página pública (sin login) con sus productos activos
-- y un botón "Pedir por WhatsApp" en vez de checkout con pasarela de
-- pago. catalogo_slug NULL = todavía no publicó su catálogo.
-- =====================================================================
ALTER TABLE empresas ADD COLUMN catalogo_slug VARCHAR(80) UNIQUE;
ALTER TABLE empresas ADD COLUMN catalogo_whatsapp VARCHAR(20);
ALTER TABLE productos ADD COLUMN imagen_url TEXT;

-- =====================================================================
-- Métodos de pago — cuentas bancarias propias, Yape/Plin, y un límite de
-- crédito por cliente para acotar cuánto puede fiarse (ventas.estado_pago
-- = 'pendiente' ya existe desde Fase 4; esto solo le pone un tope).
-- =====================================================================
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
ALTER TABLE clientes ADD COLUMN limite_credito NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (limite_credito >= 0);

-- =====================================================================
-- FACTURACIÓN ELECTRÓNICA (SUNAT)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Los datos tributarios del negocio (razón social, ubigeo, dirección) ya
-- viven en `empresas` (arriba). Los secretos (credenciales del OSE) NO
-- van en la base de datos: viven en variables de entorno (.env).
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- series_comprobantes: control de series y correlativos, por empresa —
-- cada empresa arranca su propio F001/B001 desde cero, no comparte
-- correlativos con las demás.
-- ---------------------------------------------------------------------
CREATE TABLE series_comprobantes (
    id                  BIGSERIAL PRIMARY KEY,
    company_id          BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tipo_comprobante    tipo_comprobante_electronico NOT NULL,
    serie               VARCHAR(4)          NOT NULL,   -- p.ej. F001, B001
    correlativo_actual  BIGINT              NOT NULL DEFAULT 0,
    activa              BOOLEAN             NOT NULL DEFAULT TRUE,

    UNIQUE (company_id, tipo_comprobante, serie)
);

CREATE INDEX idx_series_company ON series_comprobantes (company_id);

-- ---------------------------------------------------------------------
-- comprobantes_electronicos: un comprobante por venta (relación 1:1)
-- ---------------------------------------------------------------------
CREATE TABLE comprobantes_electronicos (
    id                      BIGSERIAL PRIMARY KEY,
    -- Denormalizado desde ventas.company_id a propósito: evita un JOIN en
    -- cada consulta de comprobantes, y deja clarísimo el aislamiento.
    company_id               BIGINT              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

    -- Para factura/boleta: la venta que documentan (obligatorio).
    -- Para nota_credito/nota_debito: la venta ORIGINAL, informativo — la
    -- relación legal real es comprobante_afectado_id (ver abajo).
    venta_id                BIGINT              REFERENCES ventas(id) ON DELETE RESTRICT,

    tipo_comprobante        tipo_comprobante_electronico NOT NULL,
    serie                   VARCHAR(4)          NOT NULL,
    correlativo             BIGINT              NOT NULL,

    -- Solo para nota_credito/nota_debito: el comprobante (factura o
    -- boleta) que esta nota modifica o anula.
    comprobante_afectado_id BIGINT              REFERENCES comprobantes_electronicos(id) ON DELETE RESTRICT,
    codigo_motivo           VARCHAR(2),          -- catálogo SUNAT 09 (notas de crédito) o 10 (notas de débito)
    motivo_detalle          VARCHAR(255),

    -- Solo para nota_credito/nota_debito: las líneas afectadas, congeladas
    -- en el momento de emitir la nota (pueden ser todas las líneas de la
    -- venta original — anulación total — o un subconjunto — devolución
    -- parcial). No se modela como tabla aparte para no complicar el
    -- esquema por un caso que siempre es de bajo volumen frente a ventas.
    lineas_nota              JSONB,

    -- receptor (congelado al momento de emisión, igual que detalle_ventas)
    cliente_tipo_documento  tipo_documento_cliente NOT NULL,
    cliente_numero_documento VARCHAR(20),
    cliente_razon_social    VARCHAR(200)        NOT NULL,
    cliente_direccion       VARCHAR(300),

    moneda                  CHAR(3)             NOT NULL DEFAULT 'PEN',
    operacion_gravada       NUMERIC(12,2)       NOT NULL CHECK (operacion_gravada >= 0),
    igv                     NUMERIC(12,2)       NOT NULL CHECK (igv >= 0),
    total                   NUMERIC(12,2)       NOT NULL CHECK (total >= 0),

    hash_cpe                VARCHAR(100),        -- código hash que devuelve NubeFacT para el comprobante firmado
    nombre_xml               VARCHAR(150),        -- RUC-tipo-serie-correlativo.xml (informativo)
    xml_firmado              TEXT,                -- solo si en el futuro se firma localmente; con NubeFacT queda NULL
    cdr_xml                  TEXT,                -- solo si en el futuro se firma localmente; con NubeFacT queda NULL
    enlace_pdf_nubefact      VARCHAR(500),        -- PDF ya generado y alojado por NubeFacT
    enlace_xml_nubefact      VARCHAR(500),        -- XML UBL ya generado y alojado por NubeFacT
    enlace_cdr_nubefact      VARCHAR(500),        -- CDR de SUNAT alojado por NubeFacT
    ticket                   VARCHAR(50),          -- para consultas asíncronas (resumen de boletas)

    estado_sunat             estado_sunat_comprobante NOT NULL DEFAULT 'pendiente',
    codigo_respuesta_sunat   VARCHAR(10),
    descripcion_respuesta    VARCHAR(500),

    -- true cuando una nota de crédito con codigo_motivo = '01' (anulación
    -- de la operación) que cubre TODAS sus líneas fue aceptada por SUNAT.
    anulado                  BOOLEAN             NOT NULL DEFAULT FALSE,

    intentos_envio           SMALLINT            NOT NULL DEFAULT 0,
    enviado_en                TIMESTAMPTZ,
    respondido_en              TIMESTAMPTZ,
    creado_en                TIMESTAMPTZ         NOT NULL DEFAULT now(),

    UNIQUE (company_id, tipo_comprobante, serie, correlativo),

    CONSTRAINT chk_nota_referencia_comprobante CHECK (
        (tipo_comprobante IN ('nota_credito','nota_debito') AND comprobante_afectado_id IS NOT NULL)
        OR
        (tipo_comprobante IN ('factura','boleta') AND comprobante_afectado_id IS NULL)
    )
);

-- Un comprobante afectado no puede tener dos anulaciones totales aceptadas,
-- pero SÍ puede tener varias notas de crédito parciales — por eso la
-- unicidad real está en (company_id, tipo_comprobante, serie, correlativo)
-- de arriba, y esta es solo para que venta_id siga siendo único entre
-- facturas/boletas (una nota de crédito puede compartir venta_id con su
-- comprobante original).
CREATE UNIQUE INDEX ux_comprobantes_venta_id
    ON comprobantes_electronicos (venta_id)
    WHERE tipo_comprobante IN ('factura', 'boleta');

CREATE INDEX idx_comprobantes_estado ON comprobantes_electronicos (estado_sunat);
CREATE INDEX idx_comprobantes_venta_id ON comprobantes_electronicos (venta_id);
CREATE INDEX idx_comprobantes_afectado ON comprobantes_electronicos (comprobante_afectado_id);
CREATE INDEX idx_comprobantes_company ON comprobantes_electronicos (company_id);

-- Una venta a crédito no tenía fecha límite de cobro — solo el estado
-- pendiente/pagada (ver migración 014_dias_credito_venta.sql). Se calcula
-- al registrar la venta como fecha + días de crédito indicados, para que
-- Cuentas por cobrar pueda marcar una deuda como vencida.
ALTER TABLE ventas ADD COLUMN fecha_vencimiento DATE;

-- ---------------------------------------------------------------------
-- trigger genérico: actualizar "actualizado_en"
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

-- Las series iniciales (F001, B001, FC01, BC01) ya no se siembran aquí:
-- ahora son por empresa (series_comprobantes.company_id), así que cada
-- empresa las recibe al crearse — ver POST /api/empresas en
-- empresas.controller.js, que inserta esas 4 filas junto con la empresa
-- y su primer usuario admin, en la misma transacción.

COMMIT;

-- =====================================================================
-- Notas de diseño — facturación electrónica
-- =====================================================================
-- 1. comprobantes_electronicos es 1:1 con ventas (UNIQUE venta_id): cada
--    venta emitida genera exactamente un comprobante. Las líneas del
--    comprobante NO se duplican: se leen de detalle_ventas, que ya
--    tiene el precio histórico congelado.
--
-- 2. correlativo se reserva de series_comprobantes dentro de la MISMA
--    transacción SQL que crea la venta (SELECT ... FOR UPDATE sobre la
--    fila de la serie), para que dos ventas concurrentes nunca reciban
--    el mismo número — ver services/correlativos.service.js.
--
-- 3. xml_firmado y cdr_xml se guardan como TEXT por simplicidad de
--    esquema; en producción con alto volumen conviene moverlos a
--    almacenamiento de archivos (S3/disco) y guardar aquí solo la ruta,
--    ya que SUNAT exige conservar XML + CDR por 5 años.
--
-- 4. estado_sunat = 'error_envio' es distinto de 'rechazado': el primero
--    es un fallo de red/timeout (reintentable automáticamente), el
--    segundo es un rechazo de SUNAT/OSE por datos inválidos (requiere
--    corrección manual antes de reintentar).
--
-- 5. Una factura o boleta YA ACEPTADA por SUNAT nunca se anula
--    directamente (no existe un "DELETE" tributario): se anula emitiendo
--    una nota de crédito con codigo_motivo = '01' (Anulación de la
--    operación) que cubra todas sus líneas — ver
--    services/notasCredito.service.js. Recién ahí `anulado` pasa a TRUE
--    y la venta original pasa a estado_documento = 'anulada'.
