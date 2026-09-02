const { conContexto } = require('../config/db');

async function listar(req, res) {
  const limite = Math.min(parseInt(req.query.limite, 10) || 100, 500);
  const filas = await conContexto({ companyId: req.usuario.companyId, userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      `SELECT a.id, a.accion, a.entidad, a.entidad_id, a.valor_anterior, a.valor_nuevo, a.creado_en,
              u.nombres, u.apellidos
         FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
        WHERE a.company_id = $1
        ORDER BY a.creado_en DESC
        LIMIT $2`,
      [req.usuario.companyId, limite]
    );
    return rows;
  });
  res.json(filas);
}

module.exports = { listar };
