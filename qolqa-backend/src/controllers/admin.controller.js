const bcrypt = require('bcrypt');
const { pool, conContexto } = require('../config/db');
const ApiError = require('../utils/ApiError');

/** Todos los planes pagados definidos hoy (tabla `planes`) — reemplaza al
 * viejo objeto hardcodeado. El monto real cobrado en cada pago lo sigue
 * decidiendo el super admin al registrarlo (puede haber descuentos, anual,
 * etc); esto solo es el precio de lista. */
async function obtenerPlanesPagados() {
  const { rows } = await pool.query('SELECT id, nombre, precio_mensual, activo FROM planes ORDER BY precio_mensual');
  return rows;
}

/** Todas las empresas (todos los tenants), para la tabla principal del
 * panel de super admin. Cross-tenant a propósito: solo llega aquí quien
 * pasó exigirSuperAdmin, y la lectura real la habilita la política RLS
 * companies_visible_superadmin. */
async function listarEmpresas(req, res) {
  const empresas = await conContexto({ userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      `SELECT c.id, c.ruc, c.razon_social, c.nombre_comercial, c.correo, c.telefono, c.direccion,
              c.plan, c.estado_suscripcion, c.suscripcion_vencimiento, c.limite_usuarios,
              c.estado, c.creado_en,
              (SELECT count(*)::int FROM company_users cu WHERE cu.company_id = c.id AND cu.activo) AS usuarios_activos
         FROM companies c
        ORDER BY c.creado_en DESC`
    );
    return rows;
  });
  res.json(empresas);
}

/** Resumen para las tarjetas superiores del panel: MRR estimado y conteo de
 * empresas por estado de suscripción. */
async function metricas(req, res) {
  const empresas = await conContexto({ userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query('SELECT plan, estado_suscripcion FROM companies');
    return rows;
  });
  const planes = await obtenerPlanesPagados();
  const precioPorPlan = Object.fromEntries(planes.map((p) => [p.id, Number(p.precio_mensual)]));

  const porEstado = { trial: 0, activo: 0, vencido: 0, suspendido: 0 };
  let mrr = 0;
  for (const e of empresas) {
    porEstado[e.estado_suscripcion] = (porEstado[e.estado_suscripcion] || 0) + 1;
    if (e.estado_suscripcion === 'activo' && precioPorPlan[e.plan]) {
      mrr += precioPorPlan[e.plan];
    }
  }

  res.json({ mrr, total_empresas: empresas.length, por_estado: porEstado });
}

/**
 * Registra un pago manual (todavía no hay pasarela integrada — ver
 * "Integración con pasarela de pago peruana" en el roadmap). Extiende
 * suscripcion_vencimiento desde el mayor entre "hoy" y el vencimiento
 * actual, deja estado_suscripcion en 'activo' y deja constancia en
 * pagos_suscripcion. dias_agregados lo decide el frontend (30 o 365 según
 * el periodo elegido) pero la fecha final la calcula el servidor, nunca se
 * confía en una fecha final mandada por el cliente.
 */
const METODOS_PAGO = ['yape', 'plin', 'transferencia', 'efectivo'];

async function registrarPago(req, res) {
  const { id } = req.params;
  const { plan, monto, dias_agregados, metodo_pago } = req.body;

  const planes = await obtenerPlanesPagados();
  const idsPlanes = planes.map((p) => p.id);
  if (!idsPlanes.includes(plan)) {
    throw new ApiError(422, 'PLAN_INVALIDO', `plan debe ser uno de: ${idsPlanes.join(', ')}.`);
  }
  const montoNum = Number(monto);
  const diasNum = Number(dias_agregados);
  if (!Number.isFinite(montoNum) || montoNum <= 0) {
    throw new ApiError(422, 'MONTO_INVALIDO', 'monto debe ser un número mayor a 0.');
  }
  if (!Number.isInteger(diasNum) || diasNum <= 0) {
    throw new ApiError(422, 'DIAS_INVALIDOS', 'dias_agregados debe ser un entero mayor a 0.');
  }
  if (metodo_pago != null && !METODOS_PAGO.includes(metodo_pago)) {
    throw new ApiError(422, 'METODO_PAGO_INVALIDO', `metodo_pago debe ser uno de: ${METODOS_PAGO.join(', ')}.`);
  }

  const resultado = await conContexto({ userId: req.usuario.id }, async (client) => {
    const { rows: empresaRows } = await client.query(
      'SELECT id, suscripcion_vencimiento FROM companies WHERE id = $1 FOR UPDATE',
      [id]
    );
    const empresa = empresaRows[0];
    if (!empresa) throw new ApiError(404, 'NO_ENCONTRADA', 'Empresa no encontrada.');

    const { rows: actualizadaRows } = await client.query(
      `UPDATE companies
          SET plan = $2,
              estado_suscripcion = 'activo',
              suscripcion_vencimiento = GREATEST(suscripcion_vencimiento, CURRENT_DATE) + ($3 || ' days')::interval
        WHERE id = $1
        RETURNING id, plan, estado_suscripcion, suscripcion_vencimiento`,
      [id, plan, diasNum]
    );

    const { rows: pagoRows } = await client.query(
      `INSERT INTO pagos_suscripcion (company_id, plan, monto, dias_agregados, metodo_pago, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, plan, monto, dias_agregados, metodo_pago, creado_en`,
      [id, plan, montoNum, diasNum, metodo_pago || null, req.usuario.id]
    );

    return { empresa: actualizadaRows[0], pago: pagoRows[0] };
  });

  res.status(201).json(resultado);
}

/** Historial de pagos de una empresa — para el modal de detalle del panel. */
async function pagosDeEmpresa(req, res) {
  const { id } = req.params;
  const pagos = await conContexto({ userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      `SELECT id, plan, monto, dias_agregados, metodo_pago, creado_en
         FROM pagos_suscripcion WHERE company_id = $1 ORDER BY creado_en DESC`,
      [id]
    );
    return rows;
  });
  res.json(pagos);
}

/** Historial de pagos de TODAS las empresas, para la vista global "Pagos y
 * Facturación" del panel — a diferencia de pagosDeEmpresa, que es por
 * empresa (usado dentro del modal de detalle). */
async function pagosGlobal(req, res) {
  const pagos = await conContexto({ userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      `SELECT p.id, p.plan, p.monto, p.dias_agregados, p.metodo_pago, p.creado_en,
              c.id AS company_id, c.ruc, c.razon_social, c.nombre_comercial
         FROM pagos_suscripcion p
         JOIN companies c ON c.id = p.company_id
        ORDER BY p.creado_en DESC
        LIMIT 200`
    );
    return rows;
  });
  res.json(pagos);
}

/** Lista todos los planes (activos e inactivos) — para la vista Planes del panel. */
async function listarPlanes(req, res) {
  res.json(await obtenerPlanesPagados());
}

/** Crea un plan nuevo (tier de precio) — no lo usa ninguna empresa hasta que se elija al registrar un pago o dar de alta una empresa. */
async function crearPlan(req, res) {
  const { id, nombre, precio_mensual } = req.body;
  if (!id || !/^[a-z][a-z0-9_]{1,19}$/.test(id)) {
    throw new ApiError(422, 'ID_INVALIDO', 'id debe ser minúsculas/números/guion bajo, 2 a 20 caracteres.');
  }
  if (!nombre) throw new ApiError(422, 'DATOS_INCOMPLETOS', 'nombre es requerido.');
  const precioNum = Number(precio_mensual);
  if (!Number.isFinite(precioNum) || precioNum <= 0) {
    throw new ApiError(422, 'PRECIO_INVALIDO', 'precio_mensual debe ser un número mayor a 0.');
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO planes (id, nombre, precio_mensual) VALUES ($1, $2, $3) RETURNING id, nombre, precio_mensual, activo',
      [id, nombre, precioNum]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'PLAN_DUPLICADO', `Ya existe un plan con id "${id}".`);
    throw err;
  }
}

/** Edita nombre/precio, o activa/desactiva un plan. Un plan desactivado
 * sigue funcionando para empresas que YA lo tienen (no las desconecta),
 * pero no aparece como opción para empresas nuevas ni para cambios de plan. */
async function actualizarPlan(req, res) {
  const { nombre, precio_mensual, activo } = req.body;
  if (precio_mensual != null && (!Number.isFinite(Number(precio_mensual)) || Number(precio_mensual) <= 0)) {
    throw new ApiError(422, 'PRECIO_INVALIDO', 'precio_mensual debe ser un número mayor a 0.');
  }

  const { rows } = await pool.query(
    `UPDATE planes SET
       nombre = COALESCE($1, nombre),
       precio_mensual = COALESCE($2, precio_mensual),
       activo = COALESCE($3, activo),
       actualizado_en = now()
     WHERE id = $4
     RETURNING id, nombre, precio_mensual, activo`,
    [nombre || null, precio_mensual != null ? Number(precio_mensual) : null, activo != null ? Boolean(activo) : null, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'PLAN_NO_ENCONTRADO', 'Ese plan no existe.');
  res.json(rows[0]);
}

function cambiarEstadoSuscripcion(estado) {
  return async function (req, res) {
    const { id } = req.params;
    const empresa = await conContexto({ userId: req.usuario.id }, async (client) => {
      const { rows } = await client.query(
        `UPDATE companies SET estado_suscripcion = $2 WHERE id = $1
         RETURNING id, plan, estado_suscripcion, suscripcion_vencimiento`,
        [id, estado]
      );
      return rows[0];
    });
    if (!empresa) throw new ApiError(404, 'NO_ENCONTRADA', 'Empresa no encontrada.');
    res.json(empresa);
  };
}

const POS_BACKEND_URL = process.env.POS_BACKEND_URL;
const POS_BACKEND_ADMIN_KEY = process.env.POS_BACKEND_ADMIN_KEY;

/**
 * Da de alta una empresa nueva desde el panel de Super Admin — hoy la
 * única vía era que el propio negocio se registrara en el sistema de
 * ventas (pos-backend). Como pos-backend y qolqa-backend son dos bases de
 * datos separadas que solo se enlazan por RUC (ver notas de arquitectura),
 * esto crea la empresa en AMBAS: primero la real (pos-backend, vía su
 * propio endpoint público de registro — ahí vive el negocio de verdad),
 * y solo si eso funciona, la espeja aquí (qolqa-backend) para que
 * aparezca en este panel con su plan/suscripción. Si pos-backend falla,
 * no tocamos nuestra base — nunca queremos una empresa "fantasma" aquí
 * que no exista de verdad en el sistema de ventas.
 */
async function crearEmpresa(req, res) {
  const { ruc, razon_social, nombre_comercial, ubigeo, direccion, admin, plan_inicial } = req.body;

  if (!ruc || !razon_social || !ubigeo || !direccion) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'ruc, razon_social, ubigeo y direccion son requeridos.');
  }
  if (!admin || !admin.nombre || !admin.email || !admin.password) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'admin.nombre, admin.email y admin.password son requeridos.');
  }
  if (plan_inicial != null && plan_inicial !== 'trial') {
    const idsPlanes = (await obtenerPlanesPagados()).map((p) => p.id);
    if (!idsPlanes.includes(plan_inicial)) {
      throw new ApiError(422, 'PLAN_INVALIDO', `plan_inicial debe ser uno de: trial, ${idsPlanes.join(', ')}.`);
    }
  }
  if (!POS_BACKEND_URL) throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL en el .env.');

  const posResp = await fetch(`${POS_BACKEND_URL}/api/empresas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ruc, razon_social, nombre_comercial: nombre_comercial || null, ubigeo, direccion, admin }),
  });
  const posData = await posResp.json().catch(() => null);
  if (!posResp.ok) {
    throw new ApiError(
      posResp.status,
      (posData && posData.error && posData.error.codigo) || 'ERROR_POS_BACKEND',
      (posData && posData.error && posData.error.mensaje) || 'No se pudo crear la empresa en el sistema de ventas.'
    );
  }

  // A partir de aquí la empresa YA existe de verdad en pos-backend — si
  // algo falla desde este punto, se lo decimos claro al super admin en
  // vez de fingir que no pasó nada, porque ya no se puede simplemente
  // "cancelar" la creación del lado real.
  try {
    const { rows: correoExistente } = await pool.query('SELECT id FROM users WHERE correo = $1', [admin.email]);
    if (correoExistente[0]) {
      throw new ApiError(
        409,
        'CORREO_EN_USO_QOLQA',
        'La empresa ya se creó en el sistema de ventas, pero ese correo ya tiene una cuenta en este panel — avísame para enlazarla a mano.'
      );
    }

    const { rows: rolAdminRows } = await pool.query("SELECT id FROM roles WHERE company_id IS NULL AND nombre = 'admin'");
    const rolAdmin = rolAdminRows[0];
    if (!rolAdmin) throw new ApiError(500, 'ROL_ADMIN_NO_SEMBRADO', 'Falta sembrar el rol "admin" en qolqa-backend.');

    const [nombres, ...resto] = admin.nombre.trim().split(/\s+/);
    const apellidos = resto.join(' ') || nombres;

    const passwordHash = await bcrypt.hash(admin.password, 12);
    const { rows: userRows } = await pool.query(
      `INSERT INTO users (nombres, apellidos, correo, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
      [nombres, apellidos, admin.email, passwordHash]
    );

    const { rows: companyRows } = await pool.query('SELECT crear_empresa($1, $2, $3, $4, $5, $6) AS id', [
      `Cuenta de ${razon_social}`,
      userRows[0].id,
      ruc,
      razon_social,
      nombre_comercial || null,
      rolAdmin.id,
    ]);
    const companyId = companyRows[0].id;

    // crear_empresa() siempre nace en trial — si el super admin ya acordó
    // un plan pagado con el cliente (ej. venta directa), lo activamos de
    // una vez con 30 días, en vez de forzarlo a pasar por "Registrar pago"
    // inmediatamente después de crear la empresa.
    if (plan_inicial && plan_inicial !== 'trial') {
      await pool.query(
        `UPDATE companies SET plan = $2, estado_suscripcion = 'activo', suscripcion_vencimiento = CURRENT_DATE + interval '30 days'
         WHERE id = $1`,
        [companyId, plan_inicial]
      );
    }

    res.status(201).json({ id: companyId, ruc, razon_social, nombre_comercial: nombre_comercial || null });
  } catch (err) {
    if (err.code === '23505') {
      throw new ApiError(
        409,
        'DUPLICADO_QOLQA',
        'La empresa ya se creó en el sistema de ventas, pero no se pudo registrar aquí (RUC o correo duplicado en este panel) — avísame para enlazarla a mano.'
      );
    }
    throw err;
  }
}

/** Busca el RUC de la empresa en NUESTRA base (companies) — es la llave
 * que compartimos con pos-backend, que tiene su propia base separada sin
 * ids en común (ver la nota de arquitectura en empresas.controller.js de
 * pos-backend: "cada empresa tiene su propio login, punto"). */
async function rucDeEmpresa(userId, companyId) {
  const empresas = await conContexto({ userId }, async (client) => {
    const { rows } = await client.query('SELECT ruc, razon_social FROM companies WHERE id = $1', [companyId]);
    return rows;
  });
  if (!empresas[0]) throw new ApiError(404, 'NO_ENCONTRADA', 'Empresa no encontrada.');
  return empresas[0];
}

/**
 * Estado de las credenciales NubeFacT de una empresa — proxya a
 * pos-backend server a server (nunca expone el token al navegador, solo
 * si está configurado o no). Si la empresa todavía no tiene una fila en
 * pos-backend (nunca completó el alta del sistema de ventas), lo dice
 * explícitamente en vez de fallar con un error genérico.
 */
async function obtenerNubefact(req, res) {
  const { ruc } = await rucDeEmpresa(req.usuario.id, req.params.id);

  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }

  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/empresas/${ruc}/nubefact`, {
    headers: { 'x-admin-key': POS_BACKEND_ADMIN_KEY },
  });
  if (resp.status === 404) {
    return res.json({ ruc, configurado: false, existe_en_ventas: false });
  }
  if (!resp.ok) throw new ApiError(502, 'ERROR_POS_BACKEND', 'No se pudo consultar el sistema de ventas.');
  const data = await resp.json();
  res.json({ ...data, existe_en_ventas: true });
}

/** Escribe las credenciales NubeFacT de una empresa, proxeando a pos-backend. */
async function actualizarNubefact(req, res) {
  const { ruta, token } = req.body;
  if (!ruta || !token) throw new ApiError(422, 'DATOS_INCOMPLETOS', 'ruta y token son requeridos.');

  const { ruc } = await rucDeEmpresa(req.usuario.id, req.params.id);

  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }

  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/empresas/${ruc}/nubefact`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': POS_BACKEND_ADMIN_KEY },
    body: JSON.stringify({ ruta, token }),
  });
  if (resp.status === 404) {
    throw new ApiError(
      404,
      'EMPRESA_NO_EXISTE_EN_VENTAS',
      'Esta empresa todavía no tiene una cuenta en el sistema de ventas — no hay dónde guardar las credenciales.'
    );
  }
  if (!resp.ok) throw new ApiError(502, 'ERROR_POS_BACKEND', 'No se pudo actualizar el sistema de ventas.');
  const data = await resp.json();
  res.json(data);
}

/**
 * Lista el staff (usuarios) de la empresa en el sistema de ventas — proxya
 * a pos-backend por RUC, igual que NubeFacT. Es lo que necesita el super
 * admin para saber a quién resetearle la contraseña si el negocio se
 * bloquea o la pierde.
 */
async function obtenerUsuariosEmpresa(req, res) {
  const { ruc } = await rucDeEmpresa(req.usuario.id, req.params.id);

  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }

  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/empresas/${ruc}/usuarios`, {
    headers: { 'x-admin-key': POS_BACKEND_ADMIN_KEY },
  });
  if (resp.status === 404) return res.json({ data: [] });
  if (!resp.ok) throw new ApiError(502, 'ERROR_POS_BACKEND', 'No se pudo consultar el sistema de ventas.');
  const data = await resp.json();
  res.json(data);
}

/** Crea un usuario del staff en el sistema de ventas de una empresa. */
async function crearUsuarioEmpresa(req, res) {
  const { ruc } = await rucDeEmpresa(req.usuario.id, req.params.id);

  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }

  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/empresas/${ruc}/usuarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': POS_BACKEND_ADMIN_KEY },
    body: JSON.stringify(req.body),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new ApiError(
      resp.status < 500 ? resp.status : 502,
      (data && data.error && data.error.codigo) || 'ERROR_POS_BACKEND',
      (data && data.error && data.error.mensaje) || 'No se pudo crear el usuario en el sistema de ventas.'
    );
  }
  res.status(201).json(data);
}

/** Edita nombre/email/rol de un usuario del staff, proxeando a pos-backend. */
async function actualizarUsuarioEmpresa(req, res) {
  const { ruc } = await rucDeEmpresa(req.usuario.id, req.params.id);

  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }

  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/empresas/${ruc}/usuarios/${req.params.usuarioId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': POS_BACKEND_ADMIN_KEY },
    body: JSON.stringify(req.body),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new ApiError(
      resp.status < 500 ? resp.status : 502,
      (data && data.error && data.error.codigo) || 'ERROR_POS_BACKEND',
      (data && data.error && data.error.mensaje) || 'No se pudo actualizar el usuario en el sistema de ventas.'
    );
  }
  res.json(data);
}

/**
 * Bloquea/desbloquea un usuario del staff (no existe "eliminar" de verdad
 * — ver la nota en pos-backend/admin.controller.js#cambiarEstadoUsuarioEmpresa:
 * el usuario queda ligado a ventas/notas que no se pueden perder).
 */
async function cambiarEstadoUsuarioEmpresa(req, res) {
  const { ruc } = await rucDeEmpresa(req.usuario.id, req.params.id);

  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }

  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/empresas/${ruc}/usuarios/${req.params.usuarioId}/estado`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': POS_BACKEND_ADMIN_KEY },
    body: JSON.stringify(req.body),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new ApiError(
      resp.status < 500 ? resp.status : 502,
      (data && data.error && data.error.codigo) || 'ERROR_POS_BACKEND',
      (data && data.error && data.error.mensaje) || 'No se pudo cambiar el estado del usuario.'
    );
  }
  res.json(data);
}

/**
 * Elimina un usuario del staff — proxya a pos-backend, que rechaza el
 * borrado (409 USUARIO_CON_ACTIVIDAD) si el usuario ya tiene ventas u
 * otros movimientos ligados, para no perder ese historial.
 */
async function eliminarUsuarioEmpresa(req, res) {
  const { ruc } = await rucDeEmpresa(req.usuario.id, req.params.id);

  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }

  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/empresas/${ruc}/usuarios/${req.params.usuarioId}`, {
    method: 'DELETE',
    headers: { 'x-admin-key': POS_BACKEND_ADMIN_KEY },
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new ApiError(
      resp.status < 500 ? resp.status : 502,
      (data && data.error && data.error.codigo) || 'ERROR_POS_BACKEND',
      (data && data.error && data.error.mensaje) || 'No se pudo eliminar el usuario en el sistema de ventas.'
    );
  }
  res.json(data);
}

/** Historial de auditoría de una empresa — proxya a pos-backend por RUC. */
async function auditoriaEmpresa(req, res) {
  const { ruc } = await rucDeEmpresa(req.usuario.id, req.params.id);

  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }

  const limite = req.query.limite ? `?limite=${encodeURIComponent(req.query.limite)}` : '';
  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/empresas/${ruc}/auditoria${limite}`, {
    headers: { 'x-admin-key': POS_BACKEND_ADMIN_KEY },
  });
  if (!resp.ok) throw new ApiError(502, 'ERROR_POS_BACKEND', 'No se pudo consultar la auditoría del sistema de ventas.');
  const data = await resp.json();
  res.json(data);
}

/**
 * La matriz de permisos por rol — no depende de ninguna empresa en
 * particular (es la misma para todas), así que solo proxya una vez a
 * pos-backend en vez de necesitar un RUC.
 */
async function obtenerMatrizPermisos(req, res) {
  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }

  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/permisos`, {
    headers: { 'x-admin-key': POS_BACKEND_ADMIN_KEY },
  });
  if (!resp.ok) throw new ApiError(502, 'ERROR_POS_BACKEND', 'No se pudo consultar la matriz de permisos.');
  const data = await resp.json();
  res.json(data);
}

/** Matriz de permisos EFECTIVA de una empresa (default global + sus personalizaciones) — proxya por RUC. */
async function obtenerPermisosEmpresa(req, res) {
  const { ruc } = await rucDeEmpresa(req.usuario.id, req.params.id);

  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }

  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/empresas/${ruc}/permisos`, {
    headers: { 'x-admin-key': POS_BACKEND_ADMIN_KEY },
  });
  if (!resp.ok) throw new ApiError(502, 'ERROR_POS_BACKEND', 'No se pudo consultar los permisos del sistema de ventas.');
  const data = await resp.json();
  res.json(data);
}

/** Personaliza los roles de UNA acción, SOLO para esta empresa. */
async function actualizarPermisoEmpresa(req, res) {
  const { ruc } = await rucDeEmpresa(req.usuario.id, req.params.id);

  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }

  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/empresas/${ruc}/permisos/${req.params.accion}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': POS_BACKEND_ADMIN_KEY },
    body: JSON.stringify(req.body),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new ApiError(
      resp.status < 500 ? resp.status : 502,
      (data && data.error && data.error.codigo) || 'ERROR_POS_BACKEND',
      (data && data.error && data.error.mensaje) || 'No se pudo guardar el permiso.'
    );
  }
  res.json(data);
}

/** Quita la personalización de una acción para esta empresa (vuelve al default global). */
async function restaurarPermisoEmpresa(req, res) {
  const { ruc } = await rucDeEmpresa(req.usuario.id, req.params.id);

  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }

  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/empresas/${ruc}/permisos/${req.params.accion}`, {
    method: 'DELETE',
    headers: { 'x-admin-key': POS_BACKEND_ADMIN_KEY },
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new ApiError(
      resp.status < 500 ? resp.status : 502,
      (data && data.error && data.error.codigo) || 'ERROR_POS_BACKEND',
      (data && data.error && data.error.mensaje) || 'No se pudo restaurar el permiso.'
    );
  }
  res.json(data);
}

/** Comprobantes que no llegaron a SUNAT, de TODAS las empresas — proxya
 * directo, no necesita RUC porque no es por empresa. */
async function alertasFacturacion(req, res) {
  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }
  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/facturacion/alertas`, {
    headers: { 'x-admin-key': POS_BACKEND_ADMIN_KEY },
  });
  if (!resp.ok) throw new ApiError(502, 'ERROR_POS_BACKEND', 'No se pudo consultar las alertas de facturación.');
  const data = await resp.json();
  res.json(data);
}

/** PDF de un comprobante puntual — proxya el binario tal cual, para que
 * Super Admin pueda ver exactamente qué venta falló al enviarse a SUNAT. */
async function verComprobantePdf(req, res) {
  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }
  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/comprobantes/${req.params.id}/pdf`, {
    headers: { 'x-admin-key': POS_BACKEND_ADMIN_KEY },
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    throw new ApiError(
      resp.status < 500 ? resp.status : 502,
      (data && data.error && data.error.codigo) || 'ERROR_POS_BACKEND',
      (data && data.error && data.error.mensaje) || 'No se pudo obtener el comprobante.'
    );
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  res.setHeader('Content-Type', resp.headers.get('content-type') || 'application/pdf');
  res.setHeader('Content-Disposition', resp.headers.get('content-disposition') || 'inline');
  res.send(buffer);
}

/** Reintenta el envío a SUNAT de un comprobante en error, desde Super Admin. */
async function reintentarComprobante(req, res) {
  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }
  const resp = await fetch(`${POS_BACKEND_URL}/api/admin/comprobantes/${req.params.id}/reintentar`, {
    method: 'POST',
    headers: { 'x-admin-key': POS_BACKEND_ADMIN_KEY },
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new ApiError(
      resp.status < 500 ? resp.status : 502,
      (data && data.error && data.error.codigo) || 'ERROR_POS_BACKEND',
      (data && data.error && data.error.mensaje) || 'No se pudo reintentar el envío.'
    );
  }
  res.json(data);
}

/**
 * Resetea la contraseña de un usuario del staff — proxya a pos-backend.
 * La contraseña temporal viaja en la respuesta UNA sola vez, nunca se
 * guarda en ningún lado; el super admin se la comunica al negocio.
 */
async function resetearPasswordUsuarioEmpresa(req, res) {
  const { ruc } = await rucDeEmpresa(req.usuario.id, req.params.id);

  if (!POS_BACKEND_URL || !POS_BACKEND_ADMIN_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta POS_BACKEND_URL / POS_BACKEND_ADMIN_KEY en el .env.');
  }

  const resp = await fetch(
    `${POS_BACKEND_URL}/api/admin/empresas/${ruc}/usuarios/${req.params.usuarioId}/reset-password`,
    { method: 'PATCH', headers: { 'x-admin-key': POS_BACKEND_ADMIN_KEY } }
  );
  if (resp.status === 404) throw new ApiError(404, 'USUARIO_NO_ENCONTRADO', 'Ese usuario no existe en el sistema de ventas.');
  if (!resp.ok) throw new ApiError(502, 'ERROR_POS_BACKEND', 'No se pudo resetear la contraseña.');
  const data = await resp.json();
  res.json(data);
}

/**
 * Edita los datos de contacto de la empresa (correo, teléfono, dirección)
 * — estos SÍ viven en nuestra propia tabla `companies`, no hace falta
 * proxy a pos-backend para esto.
 */
async function actualizarDatosEmpresa(req, res) {
  const { correo, telefono, direccion } = req.body;
  const empresas = await conContexto({ userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      `UPDATE companies SET
         correo = COALESCE($1, correo),
         telefono = COALESCE($2, telefono),
         direccion = COALESCE($3, direccion)
       WHERE id = $4
       RETURNING id, ruc, razon_social, nombre_comercial, correo, telefono, direccion`,
      [correo || null, telefono || null, direccion || null, req.params.id]
    );
    return rows;
  });
  if (!empresas[0]) throw new ApiError(404, 'NO_ENCONTRADA', 'Empresa no encontrada.');
  res.json(empresas[0]);
}

/** Comprobantes de pago subidos por las empresas (vía su propio sistema
 * de ventas vía el proxy interno), pendientes de revisión — para la vista
 * "Pagos y Facturación" del panel. Sin ?estado, trae todos. */
async function listarComprobantes(req, res) {
  const { estado } = req.query;
  const comprobantes = await conContexto({ userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      `SELECT cp.id, cp.archivo_nombre, cp.archivo_tipo, cp.monto_declarado, cp.plan_declarado,
              cp.metodo_pago, cp.estado, cp.motivo_rechazo, cp.creado_en, cp.revisado_en,
              c.id AS company_id, c.ruc, c.razon_social, c.nombre_comercial
         FROM comprobantes_pago cp
         JOIN companies c ON c.id = cp.company_id
        WHERE $1::text IS NULL OR cp.estado = $1
        ORDER BY cp.creado_en DESC
        LIMIT 200`,
      [estado || null]
    );
    return rows;
  });
  res.json(comprobantes);
}

/** Sirve el archivo (imagen/PDF) para que el super admin lo revise antes
 * de aprobar o rechazar — nunca se manda en la lista, solo aquí. */
async function obtenerArchivoComprobante(req, res) {
  const rows = await conContexto({ userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      'SELECT archivo_tipo, archivo_base64, archivo_nombre FROM comprobantes_pago WHERE id = $1',
      [req.params.id]
    );
    return rows;
  });
  const comprobante = rows[0];
  if (!comprobante) throw new ApiError(404, 'NO_ENCONTRADO', 'Comprobante no encontrado.');
  res.setHeader('Content-Type', comprobante.archivo_tipo);
  res.setHeader('Content-Disposition', `inline; filename="${comprobante.archivo_nombre}"`);
  res.send(Buffer.from(comprobante.archivo_base64, 'base64'));
}

/** Aprueba un comprobante — esto es lo que de verdad extiende la
 * suscripción, igual que registrarPago pero a partir de lo que la empresa
 * declaró al subir el archivo (el super admin ya vio la imagen/PDF antes
 * de llegar aquí). dias_agregados default 30 porque el flujo de subida de
 * comprobantes es para la mensualidad. */
async function aprobarComprobante(req, res) {
  const { id } = req.params;
  const diasNum = req.body.dias_agregados != null ? Number(req.body.dias_agregados) : 30;
  if (!Number.isInteger(diasNum) || diasNum <= 0) {
    throw new ApiError(422, 'DIAS_INVALIDOS', 'dias_agregados debe ser un entero mayor a 0.');
  }

  const resultado = await conContexto({ userId: req.usuario.id }, async (client) => {
    const { rows: cpRows } = await client.query(
      'SELECT * FROM comprobantes_pago WHERE id = $1 FOR UPDATE',
      [id]
    );
    const comprobante = cpRows[0];
    if (!comprobante) throw new ApiError(404, 'NO_ENCONTRADO', 'Comprobante no encontrado.');
    if (comprobante.estado !== 'pendiente') {
      throw new ApiError(409, 'YA_REVISADO', 'Este comprobante ya fue ' + comprobante.estado + '.');
    }

    await client.query(
      `UPDATE companies
          SET plan = $2,
              estado_suscripcion = 'activo',
              suscripcion_vencimiento = GREATEST(suscripcion_vencimiento, CURRENT_DATE) + ($3 || ' days')::interval
        WHERE id = $1`,
      [comprobante.company_id, comprobante.plan_declarado, diasNum]
    );

    const { rows: pagoRows } = await client.query(
      `INSERT INTO pagos_suscripcion (company_id, plan, monto, dias_agregados, metodo_pago, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [comprobante.company_id, comprobante.plan_declarado, comprobante.monto_declarado, diasNum, comprobante.metodo_pago, req.usuario.id]
    );

    const { rows: actualizadoRows } = await client.query(
      `UPDATE comprobantes_pago
          SET estado = 'aprobado', pago_id = $2, revisado_por = $3, revisado_en = now()
        WHERE id = $1
        RETURNING id, estado, revisado_en`,
      [id, pagoRows[0].id, req.usuario.id]
    );
    return actualizadoRows[0];
  });

  res.json(resultado);
}

async function rechazarComprobante(req, res) {
  const { motivo } = req.body;
  const comprobante = await conContexto({ userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      `UPDATE comprobantes_pago
          SET estado = 'rechazado', motivo_rechazo = $2, revisado_por = $3, revisado_en = now()
        WHERE id = $1 AND estado = 'pendiente'
        RETURNING id, estado, motivo_rechazo`,
      [req.params.id, motivo || null, req.usuario.id]
    );
    return rows[0];
  });
  if (!comprobante) throw new ApiError(409, 'NO_DISPONIBLE', 'Este comprobante no existe o ya fue revisado.');
  res.json(comprobante);
}

module.exports = {
  listarEmpresas,
  crearEmpresa,
  metricas,
  registrarPago,
  pagosDeEmpresa,
  pagosGlobal,
  listarComprobantes,
  obtenerArchivoComprobante,
  aprobarComprobante,
  rechazarComprobante,
  suspender: cambiarEstadoSuscripcion('suspendido'),
  reactivar: cambiarEstadoSuscripcion('activo'),
  obtenerNubefact,
  actualizarNubefact,
  obtenerUsuariosEmpresa,
  crearUsuarioEmpresa,
  actualizarUsuarioEmpresa,
  cambiarEstadoUsuarioEmpresa,
  eliminarUsuarioEmpresa,
  auditoriaEmpresa,
  obtenerMatrizPermisos,
  obtenerPermisosEmpresa,
  actualizarPermisoEmpresa,
  restaurarPermisoEmpresa,
  alertasFacturacion,
  verComprobantePdf,
  reintentarComprobante,
  listarPlanes,
  crearPlan,
  actualizarPlan,
  resetearPasswordUsuarioEmpresa,
  actualizarDatosEmpresa,
};
