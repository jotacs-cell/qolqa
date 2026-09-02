-- Qolqa ERP — Fase 1: autenticación, multiempresa, usuarios, roles y permisos.
--
-- Convención de aislamiento (ver arquitectura-erp-saas-peru.html, sección 04):
--   tenants   = la cuenta que paga la suscripción (puede tener 1..N companies)
--   companies = cada RUC — es el límite real de aislamiento de datos de negocio
--
-- Cada tabla que guarda datos de UNA empresa lleva company_id y tiene una
-- política Row-Level Security que exige app.company_id (fijado por el
-- middleware de tenant en cada request, dentro de la misma transacción).
-- Con current_setting(..., true) una sesión que NO fijó app.company_id
-- obtiene NULL, y "columna = NULL" nunca es verdadero — es decir, sin
-- contexto de empresa la respuesta por defecto es "ninguna fila", no "todas".

-- gen_random_uuid() es nativo desde PostgreSQL 13 — no hace falta pgcrypto.

-- ============================================================
-- Personas y cuentas
-- ============================================================

CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombres             VARCHAR(120) NOT NULL,
  apellidos           VARCHAR(120) NOT NULL,
  correo              VARCHAR(160) NOT NULL UNIQUE,
  telefono            VARCHAR(30),
  password_hash       VARCHAR(200) NOT NULL,
  correo_verificado_en TIMESTAMPTZ,
  estado              VARCHAR(20) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
  -- Dueño de la plataforma (tú), no de una empresa cliente — ve y
  -- administra TODOS los tenants desde /admin/*. Nunca se autoasigna
  -- desde la API: solo se marca a mano en la base de datos.
  es_superadmin       BOOLEAN NOT NULL DEFAULT false,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Sin RLS: una persona no es de una sola empresa (multiempresa, punto 27).
-- El correo es único a nivel de toda la plataforma: un mismo correo *es* la
-- misma persona, sin importar en cuántas empresas trabaje.

CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          VARCHAR(160) NOT NULL,
  usuario_dueño_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  estado          VARCHAR(20) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'suspendido', 'cancelado')),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Sin RLS en Fase 1: solo contiene nombre + dueño, sin datos de negocio.
-- La restricción real ("solo veo mis propios tenants") la aplica el
-- controlador (WHERE usuario_dueño_id = req.usuario.id); se revisita si
-- llegara a guardar algo más sensible (ver Fase 2 — planes y pagos).

CREATE TABLE companies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ruc              VARCHAR(11) NOT NULL UNIQUE CHECK (ruc ~ '^\d{11}$'),
  razon_social     VARCHAR(200) NOT NULL,
  nombre_comercial VARCHAR(200),
  direccion        VARCHAR(240),
  ubigeo           VARCHAR(6),
  telefono         VARCHAR(30),
  correo           VARCHAR(160),
  logo_url         VARCHAR(500),
  estado           VARCHAR(20) NOT NULL DEFAULT 'activa' CHECK (estado IN ('borrador', 'activa', 'suspendida')),
  -- Fase 2 — SaaS: plan contratado y estado de la suscripción. El acceso
  -- se corta cuando estado_suscripcion pasa a 'vencido'/'suspendido'
  -- (ver exigirSuscripcionActiva), no cuando "estado" (arriba) cambia —
  -- ese campo es sobre la empresa en sí, este es sobre el cobro.
  plan                    VARCHAR(20) NOT NULL DEFAULT 'trial',
  estado_suscripcion      VARCHAR(20) NOT NULL DEFAULT 'trial'
    CHECK (estado_suscripcion IN ('trial', 'activo', 'vencido', 'suspendido')),
  suscripcion_vencimiento DATE,
  limite_usuarios         INT,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- La política RLS de companies se crea más abajo (después de company_users,
-- que es la tabla de la que depende) — ver "Visibilidad de companies".

-- Historial de pagos de suscripción, registrados a mano por el super admin
-- (todavía no hay pasarela de pago integrada). Cada fila es un pago que
-- extendió la vigencia; company.suscripcion_vencimiento siempre refleja el
-- acumulado de estos pagos.
-- Planes de suscripción pagados — precios editables desde Super Admin
-- (antes vivían hardcodeados en admin.controller.js). Se seedearon
-- 'emprendedor'/'negocios'/'empresarial' directamente en producción vía el
-- proxy TCP de Railway (ver admin.controller.js#obtenerPlanes) — igual que
-- pasó con nubefact_ruta en pos-backend, este archivo no se re-aplica solo
-- contra producción, así que si agregas planes nuevos acá, también hay que
-- insertarlos a mano en la base real.
CREATE TABLE planes (
  id              VARCHAR(20) PRIMARY KEY,
  nombre          VARCHAR(60) NOT NULL,
  precio_mensual  NUMERIC(10,2) NOT NULL,
  activo          BOOLEAN NOT NULL DEFAULT true,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO planes (id, nombre, precio_mensual) VALUES
  ('emprendedor', 'Emprendedor', 39),
  ('negocios', 'Negocios', 79),
  ('empresarial', 'Empresarial', 149)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE pagos_suscripcion (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan              VARCHAR(20) NOT NULL,
  monto             NUMERIC(10,2) NOT NULL,
  dias_agregados    INT NOT NULL,
  -- Nullable: pagos registrados antes de este campo no tienen cómo saberlo.
  metodo_pago       VARCHAR(20) CHECK (metodo_pago IN ('yape', 'plin', 'transferencia', 'efectivo')),
  registrado_por    UUID REFERENCES users(id) ON DELETE SET NULL,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comprobante de pago que la EMPRESA CLIENTE sube desde su propio sistema
-- de ventas (pos-backend, vía el proxy interno /internal/*) declarando que
-- ya pagó su mensualidad — el super admin lo revisa aquí y, si lo aprueba,
-- eso SÍ crea el registro real en pagos_suscripcion (ver admin.controller.js
-- aprobarComprobante). El archivo se guarda en base64 en la misma fila: no
-- hay almacenamiento de blobs configurado y los comprobantes son imágenes
-- o PDFs pequeños, así que no vale la pena montar uno solo para esto.
CREATE TABLE comprobantes_pago (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  archivo_nombre    VARCHAR(200) NOT NULL,
  archivo_tipo      VARCHAR(100) NOT NULL,
  archivo_base64    TEXT NOT NULL,
  monto_declarado   NUMERIC(10,2) NOT NULL,
  plan_declarado    VARCHAR(20) NOT NULL,
  metodo_pago       VARCHAR(20) CHECK (metodo_pago IN ('yape', 'plin', 'transferencia', 'efectivo')),
  estado            VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
  motivo_rechazo    TEXT,
  pago_id           UUID REFERENCES pagos_suscripcion(id) ON DELETE SET NULL,
  revisado_por      UUID REFERENCES users(id) ON DELETE SET NULL,
  revisado_en       TIMESTAMPTZ,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nombre   VARCHAR(120) NOT NULL,
  ubigeo   VARCHAR(6),
  direccion VARCHAR(240),
  activa   BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
CREATE POLICY branches_tenant_isolation ON branches
  USING (company_id = current_setting('app.company_id', true)::uuid);

-- ============================================================
-- Funciones auxiliares para políticas RLS
-- ============================================================
-- app.company_id / app.user_id son GUCs de aplicación: current_setting(...)
-- con missing_ok=true devuelve NULL si nunca se fijaron, pero '' (cadena
-- vacía) si se fijaron con SET LOCAL en una transacción anterior de esta
-- misma conexión pooled y esa transacción ya terminó (ver la nota en
-- src/config/db.js). NULL::uuid no falla (da NULL), pero ''::uuid sí falla
-- con "invalid input syntax for type uuid".
--
-- Advertencia importante: envolver el cast en línea con guardas como
-- `x <> '' AND x::uuid = ...` o incluso `NULLIF(x, '')::uuid` NO alcanza
-- si esa expresión va directo en el USING de una política RLS — Postgres
-- puede evaluar `current_setting(...)::uuid` de forma temprana, durante la
-- planificación de la política, sin respetar el AND/CASE que lo rodea, y
-- revienta ahí igual. La única forma verificada que evita esto es meter el
-- current_setting + NULLIF + cast dentro de una función propia. Se marca
-- VOLATILE (aunque no tiene efectos secundarios reales) precisamente para
-- que el planner nunca la trate como plegable en tiempo de planificación y
-- SIEMPRE difiera la evaluación a tiempo de ejecución, fila por fila.
CREATE FUNCTION app_company_id() RETURNS uuid
LANGUAGE sql VOLATILE AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid
$$;

CREATE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql VOLATILE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;
-- Estas dos se usan SOLO donde el contexto puede ser parcial por diseño
-- (companies_visible, roles_tenant_or_template — ver más abajo). El resto
-- de políticas (branches, company_users, sessions, audit_logs) exige
-- SIEMPRE contexto completo y usa el cast directo a propósito: si falta,
-- debe fallar fuerte (500), no devolver silenciosamente cero filas — ver
-- la nota de "falla cerrado, no abierto" en conContexto (src/config/db.js).

-- ============================================================
-- RBAC: roles y permisos
-- ============================================================

CREATE TABLE permissions (
  id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clave  VARCHAR(80) NOT NULL UNIQUE,   -- "modulo.recurso.accion"
  descripcion VARCHAR(200) NOT NULL
);
-- Catálogo global — no es un dato de ninguna empresa, sin RLS.

CREATE TABLE roles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID REFERENCES companies(id) ON DELETE CASCADE, -- NULL = plantilla del sistema
  nombre         VARCHAR(80) NOT NULL,
  es_personalizado BOOLEAN NOT NULL DEFAULT false,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, nombre)
);
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_tenant_or_template ON roles
  USING (company_id IS NULL OR company_id = app_company_id());
-- Cada empresa ve las plantillas del sistema (company_id NULL) + sus propios
-- roles personalizados — nunca los roles personalizados de otra empresa.

CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
-- Sin RLS propia: siempre se consulta a través de un role_id que ya pasó
-- por el filtro de la tabla roles.

CREATE TABLE company_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  branch_id  UUID REFERENCES branches(id) ON DELETE SET NULL, -- NULL = todas las sucursales
  activo     BOOLEAN NOT NULL DEFAULT true,
  invitado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  unido_en   TIMESTAMPTZ,
  UNIQUE (user_id, company_id)
);
ALTER TABLE company_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_users FORCE ROW LEVEL SECURITY;
-- Usa app_company_id() (NULLIF + cast seguro) y no el cast directo: el
-- panel de super admin lee esta tabla en consultas cross-tenant (contar
-- usuarios de TODAS las empresas, ver admin.controller.js#listarEmpresas)
-- sin fijar app.company_id a propósito. Con el cast directo, esa consulta
-- rompía con "invalid input syntax for type uuid" apenas la conexión
-- pooled arrastraba un '' de una transacción anterior (ver la nota en
-- conContexto, src/config/db.js) — el OR con company_users_superadmin de
-- abajo nunca llegaba a aplicarse porque Postgres evalúa ambas políticas
-- y el error de conversión aborta la consulta entera. Con app_company_id()
-- esta política simplemente no matchea ninguna fila cuando no hay
-- contexto de empresa (sigue fallando cerrado para un tenant normal),
-- pero ya no lanza una excepción que tumbe la consulta completa.
CREATE POLICY company_users_tenant_isolation ON company_users
  USING (company_id = app_company_id());
-- Esta es la tabla más sensible de la Fase 1: resuelve "quién trabaja en
-- esta empresa y con qué rol". Un usuario en dos empresas tiene dos filas
-- aquí — una por empresa — cada una visible solo desde su propia empresa.

-- Fase 2 — el super admin (users.es_superadmin) necesita ver la cantidad de
-- usuarios de CUALQUIER empresa en el panel de administración. Postgres
-- combina políticas permisivas del mismo comando con OR, así que esto se
-- suma a company_users_tenant_isolation en vez de reemplazarla — solo lectura,
-- el super admin nunca necesita escribir en company_users de otra empresa.
CREATE POLICY company_users_superadmin ON company_users
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = app_user_id() AND u.es_superadmin));

-- ---- Visibilidad de companies (depende de company_users, recién creada) ----
-- El selector de "mis empresas" (multiempresa, punto 27) necesita ver TODAS
-- las empresas del usuario, no solo la activa — pero company_users tiene
-- RLS por company_id, así que una subconsulta directa a company_users
-- dentro de la política de companies solo vería la empresa activa (problema
-- circular clásico de RLS multi-tenant). Se resuelve con una función
-- SECURITY DEFINER, propiedad de un rol con privilegios (nunca del rol de
-- la API): su cuerpo corre con esos privilegios y sí puede leer todas las
-- membresías del usuario. La usan tanto la política de companies como el
-- login (para saber con qué rol entra a cada una de sus empresas).
CREATE FUNCTION user_memberships(p_user_id uuid)
RETURNS TABLE (company_id uuid, role_id uuid, branch_id uuid, activo boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id, role_id, branch_id, activo FROM company_users WHERE user_id = p_user_id;
$$;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
CREATE POLICY companies_visible ON companies
  USING (
    id = app_company_id()
    OR id IN (SELECT company_id FROM user_memberships(app_user_id()) WHERE activo)
  );
-- Probado con datos reales: un usuario en 2 empresas ve exactamente esas 2
-- al fijar solo app.user_id (sin app.company_id) — nunca las de un tercero.

-- Fase 2 — panel de super admin: ve y (vía UPDATE, para registrar pagos o
-- suspender) modifica CUALQUIER empresa. Sin FOR, la política aplica a
-- todos los comandos (SELECT/INSERT/UPDATE/DELETE), que es justo lo que
-- necesita /api/v1/admin/*. Se combina con companies_visible por OR.
CREATE POLICY companies_visible_superadmin ON companies
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = app_user_id() AND u.es_superadmin));

-- ---- Creación de una empresa nueva (registro, o "+ Agregar empresa") ----
-- Es la única operación que legítimamente rompe el círculo de RLS: crear
-- una empresa exige escribir una fila en companies y en company_users
-- ANTES de que el usuario sea miembro de nada — ninguna política normal
-- puede permitir eso sin abrir la puerta a crear membresías arbitrarias.
-- Se resuelve igual que user_company_ids(): una función SECURITY DEFINER,
-- angosta (solo hace esto, nada más), propiedad de un rol con privilegios.
CREATE FUNCTION crear_empresa(
  p_tenant_nombre     text,
  p_usuario_dueño_id  uuid,
  p_ruc               varchar(11),
  p_razon_social      varchar(200),
  p_nombre_comercial  varchar(200),
  p_admin_role_id     uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id  uuid;
  v_company_id uuid;
  v_branch_id  uuid;
BEGIN
  INSERT INTO tenants (nombre, usuario_dueño_id)
    VALUES (p_tenant_nombre, p_usuario_dueño_id) RETURNING id INTO v_tenant_id;

  INSERT INTO companies (tenant_id, ruc, razon_social, nombre_comercial)
    VALUES (v_tenant_id, p_ruc, p_razon_social, p_nombre_comercial) RETURNING id INTO v_company_id;

  INSERT INTO branches (company_id, nombre)
    VALUES (v_company_id, 'Sede Principal') RETURNING id INTO v_branch_id;

  INSERT INTO company_users (user_id, company_id, role_id, branch_id, unido_en)
    VALUES (p_usuario_dueño_id, v_company_id, p_admin_role_id, v_branch_id, now());

  RETURN v_company_id;
END;
$$;
-- Nota de seguridad: esta función NO recibe ningún dato "peligroso" — no
-- decide permisos, no acepta un role_id arbitrario sin que el llamador ya
-- haya sido autenticado por la API (el controlador siempre pasa el id del
-- rol "admin" plantilla, nunca uno que venga del body de la petición).

-- ============================================================
-- Sesiones (revocación real de JWT) y auditoría
-- ============================================================

CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    UUID REFERENCES companies(id) ON DELETE CASCADE, -- empresa activa al momento del login
  jti           UUID NOT NULL UNIQUE,
  dispositivo   VARCHAR(200),
  ip            VARCHAR(45),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  revocada_en   TIMESTAMPTZ
);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_owner_isolation ON sessions
  USING (user_id = current_setting('app.user_id', true)::uuid);
-- Una sesión es de una PERSONA, no de una empresa — por eso su política usa
-- app.user_id (fijado también por el middleware de auth) en vez de
-- app.company_id. Ver middlewares/auth.js.

CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES companies(id) ON DELETE SET NULL, -- NULL = acción de plataforma (Super Admin)
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  accion        VARCHAR(80) NOT NULL,
  entidad       VARCHAR(40),
  entidad_id    UUID,
  valor_anterior JSONB,
  valor_nuevo   JSONB,
  ip            VARCHAR(45),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_tenant_isolation ON audit_logs
  USING (company_id = current_setting('app.company_id', true)::uuid);
CREATE INDEX idx_audit_logs_company ON audit_logs (company_id, creado_en DESC);

-- ============================================================
-- Rol de aplicación y bypass exclusivo de Super Admin
-- ============================================================
-- El rol de conexión normal de la API (ej. qolqa_app) NUNCA debe tener
-- BYPASSRLS. Un segundo rol, usado solo por los endpoints de Super Admin
-- y siempre bajo auditoría, sí lo tiene:
--
--   CREATE ROLE qolqa_platform_admin LOGIN PASSWORD '...' BYPASSRLS;
--
-- No se crea aquí a propósito: es un paso manual y consciente al
-- desplegar, no algo que una migración deba dejar listo por defecto.
--
-- IMPORTANTE sobre quién ejecuta este archivo: este script (migrate.js)
-- debe correr con un rol dueño de las tablas (ej. el usuario admin de la
-- base de datos), NUNCA con qolqa_app — si qolqa_app fuera el dueño de
-- user_company_ids(), la función heredaría las mismas restricciones RLS
-- que se supone debe saltar, y el selector de empresas dejaría de
-- funcionar. qolqa_app solo necesita permiso de SELECT/INSERT/UPDATE/DELETE
-- sobre las tablas y EXECUTE sobre user_company_ids() — ver db:migrate en
-- package.json y la nota en README.md.
