const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const auditoria = require('../services/auditoria.service');
const { PERMISOS } = require('../config/permisos');
const { obtenerDatosDocumento, emitirComprobante } = require('../services/facturacion/facturacion.service');
const { generarPdfComprobante } = require('../services/facturacion/pdf.builder');

const ROLES_VALIDOS = ['admin', 'vendedor', 'cajero', 'contador'];

const ALFABETO_PASSWORD = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function generarPasswordTemporal() {
  let pass = '';
  for (let i = 0; i < 10; i++) pass += ALFABETO_PASSWORD[Math.floor(Math.random() * ALFABETO_PASSWORD.length)];
  return pass;
}

async function empresaPorRuc(ruc) {
  const { rows } = await pool.query('SELECT id FROM empresas WHERE ruc = $1', [ruc]);
  if (!rows[0]) throw new ApiError(404, 'EMPRESA_NO_ENCONTRADA', 'No hay ninguna empresa con ese RUC en el sistema de ventas.');
  return rows[0].id;
}

/**
 * Estado (sin exponer el token) de las credenciales NubeFacT de una
 * empresa, buscada por RUC — el RUC es la llave natural compartida entre
 * este sistema y qolqa-backend (dos bases de datos separadas, sin ids en
 * común). Lo usa el panel de Super Admin para mostrar "configurado / no
 * configurado" antes de pedir que se escriban credenciales nuevas.
 */
async function obtenerNubefact(req, res) {
  const { rows } = await pool.query(
    'SELECT id, ruc, razon_social, nubefact_ruta, (nubefact_token IS NOT NULL) AS tiene_token FROM empresas WHERE ruc = $1',
    [req.params.ruc]
  );
  if (!rows[0]) throw new ApiError(404, 'EMPRESA_NO_ENCONTRADA', 'No hay ninguna empresa con ese RUC en el sistema de ventas.');
  const empresa = rows[0];
  res.json({
    ruc: empresa.ruc,
    razon_social: empresa.razon_social,
    configurado: Boolean(empresa.nubefact_ruta) && empresa.tiene_token,
    nubefact_ruta: empresa.nubefact_ruta,
  });
}

/**
 * Escribe (o reemplaza) las credenciales NubeFacT de una empresa. Solo lo
 * llama qolqa-backend, server a server, nunca el navegador directamente —
 * ver exigirAdminKey en middlewares/auth.js.
 */
async function actualizarNubefact(req, res) {
  const { ruta, token } = req.body;
  if (!ruta || !token) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'ruta y token son requeridos.');
  }

  const { rows } = await pool.query(
    'UPDATE empresas SET nubefact_ruta = $1, nubefact_token = $2 WHERE ruc = $3 RETURNING id, ruc, razon_social',
    [ruta, token, req.params.ruc]
  );
  if (!rows[0]) throw new ApiError(404, 'EMPRESA_NO_ENCONTRADA', 'No hay ninguna empresa con ese RUC en el sistema de ventas.');
  res.json({ ruc: rows[0].ruc, razon_social: rows[0].razon_social, configurado: true });
}

/**
 * Lista los usuarios (staff) de una empresa por RUC — para que el panel de
 * Super Admin sepa a quién puede resetearle la contraseña. Nunca expone
 * password_hash.
 */
async function obtenerUsuarios(req, res) {
  const companyId = await empresaPorRuc(req.params.ruc);
  const { rows } = await pool.query(
    'SELECT id, nombre, email, rol, activo FROM usuarios WHERE company_id = $1 ORDER BY nombre',
    [companyId]
  );
  res.json({ data: rows });
}

/**
 * Resetea la contraseña de un usuario de la empresa (soporte: el negocio
 * se bloqueó o perdió su contraseña). Genera una temporal y la devuelve
 * en la respuesta UNA sola vez — no se guarda en texto plano en ningún
 * lado, ni siquiera acá; solo su hash queda en la base.
 */
async function resetearPasswordUsuario(req, res) {
  const companyId = await empresaPorRuc(req.params.ruc);
  const passwordTemporal = generarPasswordTemporal();
  const hash = await bcrypt.hash(passwordTemporal, 12);

  const { rows } = await pool.query(
    'UPDATE usuarios SET password_hash = $1, actualizado_en = now() WHERE id = $2 AND company_id = $3 RETURNING id, nombre, email',
    [hash, req.params.usuarioId, companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'USUARIO_NO_ENCONTRADO', 'Ese usuario no existe en esta empresa.');

  res.json({ usuario: rows[0], password_temporal: passwordTemporal });
}

/**
 * Crea un usuario del staff de una empresa desde Super Admin (soporte: el
 * negocio pide que se le dé de alta un usuario y no puede/sabe hacerlo
 * desde su propio panel). Misma validación que el alta que hace el propio
 * admin de la empresa (ver auth.controller.js#crearUsuario), pero cruzando
 * el límite de tenant vía RUC en vez de req.usuario.companyId.
 */
async function crearUsuarioEmpresa(req, res) {
  const companyId = await empresaPorRuc(req.params.ruc);
  const { nombre, email, password, rol, sucursal_id } = req.body;
  if (!nombre || !email || !password || !rol) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'nombre, email, password y rol son requeridos.');
  }
  if (!ROLES_VALIDOS.includes(rol)) {
    throw new ApiError(422, 'ROL_INVALIDO', `rol debe ser uno de: ${ROLES_VALIDOS.join(', ')}.`);
  }
  if (password.length < 8) {
    throw new ApiError(422, 'PASSWORD_DEBIL', 'La contraseña debe tener al menos 8 caracteres.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await pool.query(
      `INSERT INTO usuarios (company_id, nombre, email, password_hash, rol, sucursal_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre, email, rol, sucursal_id, activo, creado_en`,
      [companyId, nombre, email, passwordHash, rol, sucursal_id || null]
    );
    await auditoria.registrar({
      companyId, usuarioId: null, accion: 'usuario.crear_super_admin', entidad: 'usuario', entidadId: rows[0].id,
      detalle: { nombre, rol, origen: 'super_admin' },
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'EMAIL_DUPLICADO', 'Ese email ya está registrado.');
    throw err;
  }
}

/** Edita nombre/email/rol de un usuario de la empresa, desde Super Admin. */
async function actualizarUsuarioEmpresa(req, res) {
  const companyId = await empresaPorRuc(req.params.ruc);
  const { nombre, email, rol } = req.body;
  if (rol != null && !ROLES_VALIDOS.includes(rol)) {
    throw new ApiError(422, 'ROL_INVALIDO', `rol debe ser uno de: ${ROLES_VALIDOS.join(', ')}.`);
  }

  try {
    const { rows } = await pool.query(
      `UPDATE usuarios SET
         nombre = COALESCE($1, nombre),
         email = COALESCE($2, email),
         rol = COALESCE($3, rol),
         actualizado_en = now()
       WHERE id = $4 AND company_id = $5
       RETURNING id, nombre, email, rol, activo`,
      [nombre || null, email || null, rol || null, req.params.usuarioId, companyId]
    );
    if (!rows[0]) throw new ApiError(404, 'USUARIO_NO_ENCONTRADO', 'Ese usuario no existe en esta empresa.');

    await auditoria.registrar({
      companyId, usuarioId: null, accion: 'usuario.actualizar_super_admin', entidad: 'usuario', entidadId: rows[0].id,
      detalle: { nombre, email, rol, origen: 'super_admin' },
    });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'EMAIL_DUPLICADO', 'Ese email ya está registrado.');
    throw err;
  }
}

/**
 * Elimina de verdad un usuario del staff — solo funciona si nunca tuvo
 * actividad (ventas, cajas, compras, etc.), porque esas tablas referencian
 * a usuarios con ON DELETE RESTRICT a propósito, para no perder el
 * historial de quién vendió/movió qué. Si el usuario ya tiene actividad,
 * Postgres rechaza el DELETE (23503) y se lo explicamos claro al super
 * admin en vez de un error genérico: la alternativa ahí es bloquear
 * (cambiarEstadoUsuarioEmpresa), no borrar.
 */
async function eliminarUsuarioEmpresa(req, res) {
  const companyId = await empresaPorRuc(req.params.ruc);
  try {
    const { rows } = await pool.query(
      'DELETE FROM usuarios WHERE id = $1 AND company_id = $2 RETURNING id, nombre, email',
      [req.params.usuarioId, companyId]
    );
    if (!rows[0]) throw new ApiError(404, 'USUARIO_NO_ENCONTRADO', 'Ese usuario no existe en esta empresa.');

    await auditoria.registrar({
      companyId, usuarioId: null, accion: 'usuario.eliminar_super_admin', entidad: 'usuario', entidadId: rows[0].id,
      detalle: { nombre: rows[0].nombre, email: rows[0].email, origen: 'super_admin' },
    });
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    if (err.code === '23503') {
      throw new ApiError(
        409,
        'USUARIO_CON_ACTIVIDAD',
        'Este usuario ya tiene ventas, cajas u otros movimientos registrados a su nombre — no se puede eliminar sin perder ese historial. Bloquéalo en su lugar.'
      );
    }
    throw err;
  }
}

/**
 * Bloquea/desbloquea un usuario (activo = false/true) desde Super Admin.
 * Para usuarios CON actividad (la mayoría), esta es la única forma real de
 * quitarles el acceso — ver eliminarUsuarioEmpresa arriba para por qué no
 * siempre se puede borrar el registro.
 */
async function cambiarEstadoUsuarioEmpresa(req, res) {
  const companyId = await empresaPorRuc(req.params.ruc);
  const { activo } = req.body;
  if (typeof activo !== 'boolean') throw new ApiError(422, 'DATOS_INCOMPLETOS', 'activo debe ser true o false.');

  const { rows } = await pool.query(
    'UPDATE usuarios SET activo = $1, actualizado_en = now() WHERE id = $2 AND company_id = $3 RETURNING id, nombre, rol, activo',
    [activo, req.params.usuarioId, companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'USUARIO_NO_ENCONTRADO', 'Ese usuario no existe en esta empresa.');

  await auditoria.registrar({
    companyId, usuarioId: null,
    accion: (activo ? 'usuario.reactivar_super_admin' : 'usuario.bloquear_super_admin'),
    entidad: 'usuario', entidadId: rows[0].id,
  });
  res.json(rows[0]);
}

/**
 * Historial de auditoría de una empresa, para el panel de Super Admin —
 * mismo servicio y misma tabla que ya usa el propio admin de la empresa
 * (ver auditoria.controller.js), solo que aquí se llega por RUC en vez de
 * por sesión, cruzando el límite de tenant.
 */
async function auditoriaEmpresa(req, res) {
  const companyId = await empresaPorRuc(req.params.ruc);
  const limite = Math.min(parseInt(req.query.limite, 10) || 100, 500);
  const filas = await auditoria.listar({ companyId, limite });
  res.json(filas);
}

/**
 * La matriz real de permisos por rol (config/permisos.js) — es la misma
 * que decide qué puede hacer cada rol en TODAS las empresas (no es
 * configurable por empresa, es una sola matriz global del sistema). Se
 * expone de solo lectura para que el Super Admin pueda consultarla sin
 * tener que abrir el código.
 */
function obtenerMatrizPermisos(req, res) {
  res.json({ roles: ROLES_VALIDOS, permisos: PERMISOS });
}

/**
 * Matriz EFECTIVA de una empresa: el default global salvo las acciones que
 * esa empresa haya personalizado (tabla permisos_empresa). Devuelve también
 * qué acciones están personalizadas, para que el panel pueda marcarlas y
 * ofrecer "restaurar por defecto".
 */
async function obtenerPermisosEmpresa(req, res) {
  const companyId = await empresaPorRuc(req.params.ruc);
  const { rows } = await pool.query('SELECT accion, roles FROM permisos_empresa WHERE company_id = $1', [companyId]);
  const overrides = Object.fromEntries(rows.map((r) => [r.accion, r.roles]));

  const permisos = {};
  for (const accion of Object.keys(PERMISOS)) {
    permisos[accion] = overrides[accion] || PERMISOS[accion];
  }
  res.json({ roles: ROLES_VALIDOS, permisos, personalizados: Object.keys(overrides) });
}

/**
 * Fija los roles permitidos para UNA acción, SOLO para esta empresa (upsert
 * en permisos_empresa) — el resto de empresas y el resto de acciones de
 * esta misma empresa no se tocan.
 */
async function actualizarPermisoEmpresa(req, res) {
  const companyId = await empresaPorRuc(req.params.ruc);
  const { accion } = req.params;
  const { roles } = req.body;

  if (!PERMISOS[accion]) throw new ApiError(422, 'ACCION_INVALIDA', `"${accion}" no es una acción de permiso conocida.`);
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'roles debe ser un arreglo con al menos un rol.');
  }
  const invalido = roles.find((r) => !ROLES_VALIDOS.includes(r));
  if (invalido) throw new ApiError(422, 'ROL_INVALIDO', `"${invalido}" no es un rol válido.`);

  await pool.query(
    `INSERT INTO permisos_empresa (company_id, accion, roles)
     VALUES ($1, $2, $3)
     ON CONFLICT (company_id, accion) DO UPDATE SET roles = $3, actualizado_en = now()`,
    [companyId, accion, roles]
  );
  await auditoria.registrar({
    companyId, usuarioId: null, accion: 'permisos.personalizar', entidad: 'permiso', entidadId: null,
    detalle: { accion_permiso: accion, roles, origen: 'super_admin' },
  });
  res.json({ accion, roles });
}

/**
 * Comprobantes (facturas/boletas/notas) que NO llegaron a SUNAT — de TODAS
 * las empresas a la vez, no por RUC. 'error_envio' es un fallo de red/timeout
 * (reintentable); 'rechazado' es que SUNAT lo rechazó de verdad. Ambos son
 * comprobantes ya emitidos al cliente pero que legalmente no están
 * declarados todavía — por eso son una alerta, no un detalle más.
 */
async function alertasFacturacion(req, res) {
  const { rows } = await pool.query(`
    SELECT ce.id, ce.tipo_comprobante, ce.serie, ce.correlativo, ce.estado_sunat,
           ce.codigo_respuesta_sunat, ce.descripcion_respuesta, ce.intentos_envio,
           ce.total, ce.creado_en, ce.enviado_en,
           e.id AS company_id, e.ruc, e.razon_social, e.nombre_comercial
      FROM comprobantes_electronicos ce
      JOIN empresas e ON e.id = ce.company_id
     WHERE ce.estado_sunat IN ('error_envio', 'rechazado')
     ORDER BY ce.creado_en DESC
     LIMIT 300
  `);
  res.json(rows);
}

/**
 * PDF de un comprobante puntual, para que Super Admin pueda ver qué venta
 * es exactamente la que falló al enviarse (sin esto, "Alertas SUNAT" solo
 * mostraba el motivo del error, no el documento). No hace falta pasar por
 * RUC porque el id de comprobante ya es único en todo el sistema.
 */
async function verComprobantePdf(req, res) {
  const { comprobante, empresa, lineas, comprobanteAfectado } = await obtenerDatosDocumento(Number(req.params.id));
  const pdfBuffer = await generarPdfComprobante(comprobante, empresa, lineas, comprobanteAfectado);
  const nombreArchivo = `${comprobante.tipo_comprobante}-${comprobante.serie}-${comprobante.correlativo}.pdf`;
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="${nombreArchivo}"`);
  res.send(pdfBuffer);
}

/**
 * Reintenta el envío a SUNAT de un comprobante en error — la misma acción
 * que "Reenviar" en el propio sistema de ventas (comprobantes.controller.js
 * #reenviar), pero disponible desde Super Admin para cuando el negocio no
 * puede o no sabe hacerlo, típicamente justo después de que Super Admin le
 * configuró las credenciales de NubeFacT que le faltaban.
 */
async function reintentarComprobante(req, res) {
  const { comprobante } = await obtenerDatosDocumento(Number(req.params.id));
  if (comprobante.estado_sunat === 'aceptado' || comprobante.estado_sunat === 'aceptado_con_observaciones') {
    throw new ApiError(409, 'YA_ACEPTADO', 'Este comprobante ya fue aceptado por SUNAT, no hace falta reenviarlo.');
  }
  const resultado = await emitirComprobante(comprobante.id);
  await auditoria.registrar({
    companyId: comprobante.company_id, usuarioId: null, accion: 'comprobante.reenviar_super_admin',
    entidad: 'comprobante', entidadId: comprobante.id, detalle: { origen: 'super_admin' },
  });
  res.json({ id: comprobante.id, ...resultado });
}

/** Quita la personalización de una acción para esta empresa — vuelve a
 * usar el default global de PERMISOS. */
async function restaurarPermisoEmpresa(req, res) {
  const companyId = await empresaPorRuc(req.params.ruc);
  const { accion } = req.params;
  if (!PERMISOS[accion]) throw new ApiError(422, 'ACCION_INVALIDA', `"${accion}" no es una acción de permiso conocida.`);

  await pool.query('DELETE FROM permisos_empresa WHERE company_id = $1 AND accion = $2', [companyId, accion]);
  await auditoria.registrar({
    companyId, usuarioId: null, accion: 'permisos.restaurar_default', entidad: 'permiso', entidadId: null,
    detalle: { accion_permiso: accion, origen: 'super_admin' },
  });
  res.json({ accion, roles: PERMISOS[accion] });
}

module.exports = {
  obtenerNubefact,
  actualizarNubefact,
  obtenerUsuarios,
  resetearPasswordUsuario,
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
};
