const { pool, conTransaccion } = require('../config/db');
const ApiError = require('../utils/ApiError');
const ventasService = require('../services/ventas.service');
const { emitirComprobante } = require('../services/facturacion/facturacion.service');
const { construirContenidoQr } = require('../services/facturacion/pdf.builder');
const kardex = require('../services/kardex.service');
const { tienePermiso } = require('../config/permisos');
const auditoria = require('../services/auditoria.service');

async function crear(req, res) {
  const { cliente_id, metodo_pago, items, tipo_comprobante, es_credito, dias_credito, almacen_id } = req.body;

  // "Un vendedor podría emitir una boleta, pero no anularla" — la otra cara
  // de la misma regla: un cajero puede emitir boleta/recibo pero NO factura
  // (emitirFactura solo está en la lista de admin/vendedor, ver permisos.js).
  // Va aquí y no en la ruta porque depende de tipo_comprobante, que viene en
  // el body, no en la URL.
  if (tipo_comprobante === 'factura' && !tienePermiso(req.usuario.rol, 'emitirFactura')) {
    throw new ApiError(403, 'PERMISO_INSUFICIENTE', 'Tu rol no puede emitir facturas — solo boletas o recibos.');
  }

  const { venta, comprobanteId } = await ventasService.registrarVenta({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    clienteId: cliente_id,
    metodoPago: metodo_pago,
    items,
    tipoComprobante: tipo_comprobante,
    esCredito: !!es_credito,
    diasCredito: dias_credito,
    almacenId: almacen_id || null,
  });

  // La venta YA quedó confirmada en la base de datos en este punto.
  // El envío a SUNAT ocurre ahora, fuera de la transacción de la venta —
  // salvo para "recibo", que no es un documento SUNAT y no tiene comprobante
  // que enviar (comprobanteId viene null desde registrarVenta).
  const resultadoEnvio = comprobanteId
    ? await emitirComprobante(comprobanteId)
    : { estado: 'no_aplica', descripcion: 'Recibo interno — no se envía a SUNAT.' };

  // El frontend usa serie/correlativo para nombrar el PDF/ticket que se
  // descarga justo después de confirmar la venta (ej. "B001-000005.pdf"
  // en vez de un id numérico interno), igual que ya hace en las listas.
  let datosDocumento = {};
  if (comprobanteId) {
    const { rows } = await pool.query(
      'SELECT serie, correlativo, tipo_comprobante FROM comprobantes_electronicos WHERE id = $1',
      [comprobanteId]
    );
    datosDocumento = rows[0] || {};
  }

  await auditoria.registrar({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    accion: `venta.emitir_${tipo_comprobante}`,
    entidad: 'venta',
    entidadId: venta.id,
    detalle: { comprobanteId, total: venta.total },
  });

  res.status(201).json({
    venta,
    comprobante: { id: comprobanteId, ...datosDocumento, ...resultadoEnvio },
  });
}

async function listar(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = (page - 1) * limit;

  const condiciones = [`v.company_id = $1`];
  const valores = [req.usuario.companyId];

  // Un cajero solo ve sus propias ventas, sin importar qué mande en el query string.
  const usuarioIdFiltro = req.usuario.rol === 'cajero' ? req.usuario.id : req.query.usuario_id;
  if (usuarioIdFiltro) {
    valores.push(usuarioIdFiltro);
    condiciones.push(`v.usuario_id = $${valores.length}`);
  }
  if (req.query.desde) {
    valores.push(req.query.desde);
    condiciones.push(`v.fecha >= $${valores.length}`);
  }
  if (req.query.hasta) {
    valores.push(req.query.hasta);
    condiciones.push(`v.fecha <= $${valores.length}`);
  }
  if (req.query.estado_documento) {
    valores.push(req.query.estado_documento);
    condiciones.push(`v.estado_documento = $${valores.length}`);
  }
  if (req.query.estado_pago) {
    valores.push(req.query.estado_pago);
    condiciones.push(`v.estado_pago = $${valores.length}`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows: data } = await pool.query(
    `SELECT v.id, v.fecha, v.total, v.metodo_pago, v.estado_documento, v.estado_pago, v.fecha_vencimiento, v.cliente_id,
            c.id AS comprobante_id, c.tipo_comprobante, c.serie, c.correlativo, c.estado_sunat,
            cl.razon_social_o_nombre AS cliente_nombre,
            COALESCE((SELECT SUM(monto) FROM pagos_venta WHERE venta_id = v.id), 0) AS total_pagado
       FROM ventas v
       LEFT JOIN comprobantes_electronicos c ON c.venta_id = v.id
       LEFT JOIN clientes cl ON cl.id = v.cliente_id
       ${where}
       ORDER BY v.fecha DESC
       LIMIT ${limit} OFFSET ${offset}`,
    valores
  );
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ventas v ${where}`,
    valores
  );

  res.json({ data, paginacion: { page, limit, total: countRows[0].total, total_paginas: Math.ceil(countRows[0].total / limit) } });
}

async function obtener(req, res) {
  const { rows: ventaRows } = await pool.query('SELECT * FROM ventas WHERE id = $1 AND company_id = $2', [
    req.params.id,
    req.usuario.companyId,
  ]);
  const venta = ventaRows[0];
  if (!venta) throw new ApiError(404, 'NO_ENCONTRADO', 'Venta no encontrada.');
  if (req.usuario.rol === 'cajero' && venta.usuario_id !== req.usuario.id) {
    throw new ApiError(404, 'NO_ENCONTRADO', 'Venta no encontrada.');
  }

  const { rows: items } = await pool.query(
    `SELECT dv.producto_id, p.nombre, dv.cantidad, dv.precio_unitario_historico, dv.subtotal
       FROM detalle_ventas dv JOIN productos p ON p.id = dv.producto_id
      WHERE dv.venta_id = $1 ORDER BY dv.id`,
    [venta.id]
  );
  const { rows: comprobanteRows } = await pool.query(
    `SELECT id, tipo_comprobante, serie, correlativo, estado_sunat, hash_cpe,
            cliente_tipo_documento, cliente_numero_documento, cliente_razon_social, cliente_direccion, igv, total, creado_en,
            enlace_pdf_nubefact, enlace_xml_nubefact, enlace_cdr_nubefact
       FROM comprobantes_electronicos WHERE venta_id = $1`,
    [venta.id]
  );
  let comprobante = comprobanteRows[0] || null;

  // La "cadena QR" (los 10 campos que exige SUNAT, separados por "|") solo
  // tiene sentido mostrarla una vez que el comprobante fue aceptado — antes
  // de eso el hash_cpe todavía no existe. Se arma con los mismos datos que
  // ya usa el PDF (ver pdf.builder.js), no hay que volver a definirlos.
  if (comprobante && (comprobante.estado_sunat === 'aceptado' || comprobante.estado_sunat === 'aceptado_con_observaciones')) {
    const { rows: empresaRows } = await pool.query('SELECT ruc FROM empresas WHERE id = $1', [req.usuario.companyId]);
    if (empresaRows[0]) {
      comprobante = { ...comprobante, cadena_qr: construirContenidoQr(comprobante, empresaRows[0]) };
    }
  }

  res.json({ ...venta, items, comprobante });
}

async function anular(req, res) {
  const { motivo } = req.body;
  if (!motivo) throw new ApiError(422, 'MOTIVO_REQUERIDO', 'Debes indicar el motivo de la anulación.');

  const resultado = await conTransaccion(async (client) => {
    const { rows } = await client.query(
      `SELECT id, estado_documento FROM ventas WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [req.params.id, req.usuario.companyId]
    );
    const venta = rows[0];
    if (!venta) throw new ApiError(404, 'NO_ENCONTRADO', 'Venta no encontrada.');
    if (venta.estado_documento === 'anulada') {
      throw new ApiError(409, 'YA_ANULADA', 'Esta venta ya estaba anulada.');
    }

    // Si el comprobante ya fue ACEPTADO por SUNAT, esta ruta NUNCA es
    // válida — solo actualiza banderas locales, jamás avisa a SUNAT/
    // NubeFacT, así que un comprobante aceptado quedaría "anulado" acá
    // mientras SUNAT lo sigue considerando válido y emitido. La regla
    // real de SUNAT ("comunicación de baja" el mismo día) SÍ existe,
    // pero requiere una llamada a NubeFacT que este sistema todavía no
    // implementa (no está verificada contra el manual real de la
    // cuenta) — hasta que exista, la única ruta correcta para un
    // comprobante aceptado es la nota de crédito, sin excepción por
    // fecha.
    const { rows: comprobanteRows } = await client.query(
      'SELECT id, estado_sunat FROM comprobantes_electronicos WHERE venta_id = $1',
      [venta.id]
    );
    const comprobante = comprobanteRows[0];
    if (comprobante && ['aceptado', 'aceptado_con_observaciones'].includes(comprobante.estado_sunat)) {
      throw new ApiError(
        409,
        'REQUIERE_NOTA_CREDITO',
        'El comprobante de esta venta ya fue aceptado por SUNAT: no se puede anular directamente. ' +
          `Usa PATCH /api/comprobantes/${comprobante.id}/anular para emitir la nota de crédito correspondiente.`
      );
    }

    await client.query("UPDATE ventas SET estado_documento = 'anulada' WHERE id = $1", [venta.id]);

    // Reponer stock de cada línea
    const { rows: lineas } = await client.query(
      'SELECT producto_id, cantidad FROM detalle_ventas WHERE venta_id = $1',
      [venta.id]
    );
    const almacenId = await kardex.obtenerAlmacenPrincipal(client, req.usuario.companyId);
    for (const linea of lineas) {
      await kardex.registrarMovimiento(client, {
        companyId: req.usuario.companyId, productoId: linea.producto_id, almacenId, tipo: 'entrada', cantidad: linea.cantidad,
        motivo: 'Venta anulada', referenciaTipo: 'venta_anulada', referenciaId: venta.id, usuarioId: req.usuario.id,
      });
    }

    await client.query(
      "UPDATE comprobantes_electronicos SET estado_sunat = 'anulado' WHERE venta_id = $1",
      [venta.id]
    );

    return { id: venta.id, estado_documento: 'anulada', motivo };
  });

  // Este camino solo corre cuando el comprobante TODAVÍA NO fue aceptado
  // por SUNAT (pendiente, en error, o rechazado) — por eso alcanza con
  // marcarlo 'anulado' internamente, sin generar ningún documento nuevo.
  // Si ya estaba aceptado, el bloque de arriba lanzó 409 antes de llegar
  // aquí y hay que usar PATCH /api/comprobantes/:id/anular en su lugar.
  await auditoria.registrar({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    accion: 'venta.anular',
    entidad: 'venta',
    entidadId: resultado.id,
    detalle: { motivo },
  });

  res.json(resultado);
}

/**
 * Cobra el SALDO COMPLETO restante de una venta a crédito de un solo tiro
 * (atajo que usa Cuentas por cobrar para "marcar como pagada" sin pedir
 * monto) — registra igual un renglón en pagos_venta con el método de pago
 * que ya trae la venta, para que el historial de cobros nunca quede
 * desalineado del estado. Para un abono PARCIAL usar registrarPago.
 */
async function marcarPagada(req, res) {
  const resultado = await conTransaccion(async (client) => {
    const { rows: ventaRows } = await client.query(
      `SELECT id, total, metodo_pago, estado_pago,
              COALESCE((SELECT SUM(monto) FROM pagos_venta WHERE venta_id = ventas.id), 0) AS total_pagado
         FROM ventas WHERE id = $1 AND company_id = $2 AND estado_documento != 'anulada' FOR UPDATE`,
      [req.params.id, req.usuario.companyId]
    );
    const venta = ventaRows[0];
    if (!venta) throw new ApiError(404, 'NO_ENCONTRADO', 'Venta no encontrada o ya anulada.');
    const saldoPendiente = Number(venta.total) - Number(venta.total_pagado);
    if (saldoPendiente > 0) {
      await client.query(
        `INSERT INTO pagos_venta (venta_id, monto, metodo_pago, usuario_id) VALUES ($1, $2, $3, $4)`,
        [venta.id, saldoPendiente.toFixed(2), venta.metodo_pago, req.usuario.id]
      );
    }
    const { rows } = await client.query(
      `UPDATE ventas SET estado_pago = 'pagada' WHERE id = $1 RETURNING id, estado_pago`,
      [venta.id]
    );
    return rows[0];
  });
  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'venta.marcar_pagada', entidad: 'venta', entidadId: resultado.id,
  });
  res.json(resultado);
}

/** Historial de abonos de una venta a crédito, del más antiguo al más reciente. */
async function listarPagos(req, res) {
  await ventaDeLaEmpresa(req.params.id, req.usuario.companyId);
  const { rows } = await pool.query(
    `SELECT pv.id, pv.monto, pv.metodo_pago, pv.creado_en, u.nombre AS usuario_nombre
       FROM pagos_venta pv JOIN usuarios u ON u.id = pv.usuario_id
      WHERE pv.venta_id = $1
      ORDER BY pv.creado_en ASC`,
    [req.params.id]
  );
  res.json({ data: rows });
}

/**
 * Registra un abono — parcial o que termina de cubrir el saldo — contra
 * una venta a crédito. A diferencia de marcarPagada (todo el saldo de un
 * tiro), acá el monto lo decide quien cobra, y nunca puede pasarse del
 * saldo pendiente (no se acepta sobre-pago). El estado resultante se
 * calcula comparando la suma de TODOS los abonos contra ventas.total:
 * 'parcial' si todavía falta, 'pagada' si con este abono se cubre.
 */
async function registrarPago(req, res) {
  const monto = Number(req.body.monto);
  const metodoPago = req.body.metodo_pago;
  if (!(monto > 0)) throw new ApiError(422, 'DATOS_INCOMPLETOS', 'monto debe ser mayor a 0.');
  if (!metodoPago) throw new ApiError(422, 'DATOS_INCOMPLETOS', 'metodo_pago es requerido.');

  const resultado = await conTransaccion(async (client) => {
    const { rows: ventaRows } = await client.query(
      `SELECT id, total, estado_pago,
              COALESCE((SELECT SUM(monto) FROM pagos_venta WHERE venta_id = ventas.id), 0) AS total_pagado
         FROM ventas WHERE id = $1 AND company_id = $2 AND estado_documento != 'anulada' FOR UPDATE`,
      [req.params.id, req.usuario.companyId]
    );
    const venta = ventaRows[0];
    if (!venta) throw new ApiError(404, 'NO_ENCONTRADO', 'Venta no encontrada o ya anulada.');
    const saldoPendiente = Number(venta.total) - Number(venta.total_pagado);
    if (saldoPendiente <= 0) throw new ApiError(409, 'YA_PAGADA', 'Esta venta ya no tiene saldo pendiente.');
    if (monto > saldoPendiente + 0.01) {
      throw new ApiError(422, 'MONTO_EXCEDE_SALDO', `El monto no puede superar el saldo pendiente (S/ ${saldoPendiente.toFixed(2)}).`);
    }

    await client.query(
      `INSERT INTO pagos_venta (venta_id, monto, metodo_pago, usuario_id) VALUES ($1, $2, $3, $4)`,
      [venta.id, monto.toFixed(2), metodoPago, req.usuario.id]
    );
    const totalPagado = Number(venta.total_pagado) + monto;
    const nuevoEstado = totalPagado >= Number(venta.total) - 0.01 ? 'pagada' : 'parcial';
    const { rows } = await client.query(
      `UPDATE ventas SET estado_pago = $2 WHERE id = $1 RETURNING id, estado_pago`,
      [venta.id, nuevoEstado]
    );
    return { ...rows[0], total_pagado: totalPagado, saldo_pendiente: Math.max(0, Number(venta.total) - totalPagado) };
  });

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'venta.registrar_pago', entidad: 'venta', entidadId: resultado.id, detalle: { monto, metodo_pago: metodoPago },
  });
  res.status(201).json(resultado);
}

/** Confirma que la venta es de esta empresa antes de tocar sus notas —
 * las notas cuelgan de venta_id sin su propio company_id, así que sin
 * este chequeo una empresa podría leer/escribir notas de otra con solo
 * adivinar un id numérico consecutivo. */
async function ventaDeLaEmpresa(ventaId, companyId) {
  const { rows } = await pool.query('SELECT id FROM ventas WHERE id = $1 AND company_id = $2', [ventaId, companyId]);
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Venta no encontrada.');
}

/** Línea de tiempo de notas de una venta — texto libre que cualquier
 * usuario de la empresa puede leer, ordenado del más antiguo al más
 * reciente (como una bitácora, no una lista invertida). */
async function listarNotas(req, res) {
  await ventaDeLaEmpresa(req.params.id, req.usuario.companyId);
  const { rows } = await pool.query(
    `SELECT n.id, n.texto, n.creado_en, u.nombre AS usuario_nombre
       FROM notas_venta n JOIN usuarios u ON u.id = n.usuario_id
      WHERE n.venta_id = $1
      ORDER BY n.creado_en ASC`,
    [req.params.id]
  );
  res.json({ data: rows });
}

/** Agrega una nota — nunca se edita ni se borra después (bitácora). */
async function agregarNota(req, res) {
  await ventaDeLaEmpresa(req.params.id, req.usuario.companyId);
  const texto = (req.body.texto || '').trim();
  if (!texto) throw new ApiError(422, 'DATOS_INCOMPLETOS', 'texto es requerido.');
  if (texto.length > 2000) throw new ApiError(422, 'TEXTO_MUY_LARGO', 'La nota no puede pasar de 2000 caracteres.');

  const { rows } = await pool.query(
    `INSERT INTO notas_venta (venta_id, usuario_id, texto) VALUES ($1, $2, $3) RETURNING id, texto, creado_en`,
    [req.params.id, req.usuario.id, texto]
  );
  res.status(201).json({ ...rows[0], usuario_nombre: req.usuario.nombre });
}

module.exports = { crear, listar, obtener, anular, marcarPagada, listarPagos, registrarPago, listarNotas, agregarNota };
