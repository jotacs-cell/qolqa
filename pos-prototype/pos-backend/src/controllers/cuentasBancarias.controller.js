const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');

const TIPOS_VALIDOS = ['ahorro', 'corriente', 'cci'];
const MONEDAS_VALIDAS = ['PEN', 'USD'];

async function listar(req, res) {
  const { rows } = await pool.query(
    `SELECT id, banco, titular, numero_cuenta, tipo_cuenta, moneda, activa
       FROM cuentas_bancarias WHERE company_id = $1
      ORDER BY activa DESC, banco`,
    [req.usuario.companyId]
  );
  res.json({ data: rows });
}

async function crear(req, res) {
  const { banco, titular, numero_cuenta, tipo_cuenta = 'ahorro', moneda = 'PEN' } = req.body;
  if (!banco || !titular || !numero_cuenta) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'banco, titular y numero_cuenta son requeridos.');
  }
  if (!TIPOS_VALIDOS.includes(tipo_cuenta)) {
    throw new ApiError(422, 'TIPO_CUENTA_INVALIDO', `tipo_cuenta debe ser uno de: ${TIPOS_VALIDOS.join(', ')}.`);
  }
  if (!MONEDAS_VALIDAS.includes(moneda)) {
    throw new ApiError(422, 'MONEDA_INVALIDA', `moneda debe ser una de: ${MONEDAS_VALIDAS.join(', ')}.`);
  }

  const { rows } = await pool.query(
    `INSERT INTO cuentas_bancarias (company_id, banco, titular, numero_cuenta, tipo_cuenta, moneda)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.usuario.companyId, banco, titular, numero_cuenta, tipo_cuenta, moneda]
  );
  res.status(201).json(rows[0]);
}

async function actualizar(req, res) {
  const { banco, titular, numero_cuenta, tipo_cuenta, moneda } = req.body;
  if (tipo_cuenta != null && !TIPOS_VALIDOS.includes(tipo_cuenta)) {
    throw new ApiError(422, 'TIPO_CUENTA_INVALIDO', `tipo_cuenta debe ser uno de: ${TIPOS_VALIDOS.join(', ')}.`);
  }
  if (moneda != null && !MONEDAS_VALIDAS.includes(moneda)) {
    throw new ApiError(422, 'MONEDA_INVALIDA', `moneda debe ser una de: ${MONEDAS_VALIDAS.join(', ')}.`);
  }

  const { rows } = await pool.query(
    `UPDATE cuentas_bancarias SET
       banco = COALESCE($1, banco),
       titular = COALESCE($2, titular),
       numero_cuenta = COALESCE($3, numero_cuenta),
       tipo_cuenta = COALESCE($4, tipo_cuenta),
       moneda = COALESCE($5, moneda)
     WHERE id = $6 AND company_id = $7
     RETURNING *`,
    [banco, titular, numero_cuenta, tipo_cuenta, moneda, req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Cuenta bancaria no encontrada.');
  res.json(rows[0]);
}

async function cambiarEstado(req, res) {
  const { activa } = req.body;
  const { rows } = await pool.query(
    'UPDATE cuentas_bancarias SET activa = $1 WHERE id = $2 AND company_id = $3 RETURNING id, activa',
    [Boolean(activa), req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Cuenta bancaria no encontrada.');
  res.json(rows[0]);
}

async function eliminar(req, res) {
  const { rows } = await pool.query(
    'DELETE FROM cuentas_bancarias WHERE id = $1 AND company_id = $2 RETURNING id',
    [req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Cuenta bancaria no encontrada.');
  res.status(204).send();
}

module.exports = { listar, crear, actualizar, cambiarEstado, eliminar };
