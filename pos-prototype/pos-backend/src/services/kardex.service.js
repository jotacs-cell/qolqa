const ApiError = require('../utils/ApiError');

// El signo lo da el `tipo`, nunca el número que manda el llamador —
// `cantidad` siempre es positiva (ver CHECK de la tabla).
const DIRECCION = {
  entrada: 1,
  ajuste_positivo: 1,
  transferencia_entrada: 1,
  salida: -1,
  ajuste_negativo: -1,
  transferencia_salida: -1,
};

async function obtenerAlmacenPrincipal(client, companyId) {
  const { rows } = await client.query('SELECT id FROM almacenes WHERE company_id = $1 AND es_principal LIMIT 1', [companyId]);
  if (!rows[0]) throw new Error(`La empresa ${companyId} no tiene almacén principal — esto no debería pasar (ver empresas.controller.js#crear).`);
  return rows[0].id;
}

/**
 * Único lugar que debe tocar stock real (no reservas) de un producto:
 * actualiza producto_stock (detalle por almacén), productos.stock (total
 * de la empresa — así el código existente que ya lee/escribe ese campo
 * sigue funcionando sin cambios) y deja constancia en
 * kardex_movimientos. SIEMPRE debe correr dentro de la MISMA transacción
 * que el resto del cambio que la origina (recibe `client`, nunca abre su
 * propia transacción) — si algo después falla, el movimiento se revierte
 * junto con todo lo demás.
 *
 * No se usa para reservas de pedidos (productos.stock_reservado) — eso no
 * es un movimiento real de mercadería, es un compromiso todavía no
 * cumplido; el kardex solo registra stock que de verdad entró o salió.
 */
async function registrarMovimiento(client, { companyId, productoId, almacenId, tipo, cantidad, motivo, referenciaTipo, referenciaId, usuarioId }) {
  const signo = DIRECCION[tipo];
  if (!signo) throw new Error(`Tipo de movimiento de kardex inválido: ${tipo}.`);
  if (!(Number(cantidad) > 0)) throw new Error('cantidad debe ser mayor a cero para registrar un movimiento de kardex.');

  const delta = signo * cantidad;
  // OJO: NO se usa INSERT ... ON CONFLICT DO UPDATE aquí — Postgres valida
  // el CHECK sobre el valor propuesto del INSERT incluso cuando termina
  // resolviéndose como UPDATE por el conflicto, así que un delta negativo
  // sobre una fila ya existente con stock de sobra fallaba igual. Se hace
  // explícito: SELECT ... FOR UPDATE para bloquear la fila (o su ausencia)
  // y recién ahí INSERT o UPDATE según corresponda.
  let stockResultante;
  try {
    const { rows: existentes } = await client.query(
      'SELECT stock FROM producto_stock WHERE producto_id = $1 AND almacen_id = $2 FOR UPDATE',
      [productoId, almacenId]
    );
    if (existentes[0]) {
      const { rows } = await client.query(
        'UPDATE producto_stock SET stock = stock + $1 WHERE producto_id = $2 AND almacen_id = $3 RETURNING stock',
        [delta, productoId, almacenId]
      );
      stockResultante = rows[0].stock;
    } else {
      const { rows } = await client.query(
        'INSERT INTO producto_stock (producto_id, almacen_id, stock) VALUES ($1, $2, $3) RETURNING stock',
        [productoId, almacenId, delta]
      );
      stockResultante = rows[0].stock;
    }
  } catch (err) {
    if (err.code === '23514') { // violación de CHECK (stock >= 0)
      throw new ApiError(409, 'STOCK_INSUFICIENTE', `Stock insuficiente en el almacén para el producto ${productoId}.`, { producto_id: productoId, almacen_id: almacenId });
    }
    throw err;
  }

  await client.query(
    `INSERT INTO kardex_movimientos
       (company_id, producto_id, almacen_id, tipo, cantidad, stock_resultante, motivo, referencia_tipo, referencia_id, usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [companyId, productoId, almacenId, tipo, cantidad, stockResultante, motivo || null, referenciaTipo || null, referenciaId || null, usuarioId]
  );

  // productos.stock es el TOTAL de la empresa (suma de todos sus
  // almacenes) — se mantiene en sincronía aquí mismo, en la misma
  // transacción, para que nunca quede desalineado del detalle real.
  await client.query('UPDATE productos SET stock = stock + $1 WHERE id = $2', [signo * cantidad, productoId]);

  return { stockResultante };
}

/**
 * Stock realmente disponible (no reservado) de un producto EN UN ALMACÉN
 * específico — a diferencia de productos.stock/stock_reservado, que son
 * el TOTAL de la empresa. Fase 10: antes de esto, la venta/el pedido
 * chequeaban el total de la empresa aunque el pedido fuera a salir de un
 * almacén puntual, lo que dejaba vender de un almacén con 0 unidades si
 * OTRO almacén tenía stock de sobra.
 */
async function disponibleEnAlmacen(client, productoId, almacenId) {
  const { rows } = await client.query(
    'SELECT stock, stock_reservado FROM producto_stock WHERE producto_id = $1 AND almacen_id = $2',
    [productoId, almacenId]
  );
  if (!rows[0]) return 0;
  return rows[0].stock - rows[0].stock_reservado;
}

/**
 * Reserva (delta > 0) o libera (delta < 0) stock de un pedido "confirmado"
 * en UN ALMACÉN específico. No es un movimiento real — nada entra ni sale
 * físicamente todavía — así que a diferencia de registrarMovimiento NO
 * genera kardex; solo mantiene producto_stock.stock_reservado (por
 * almacén) y productos.stock_reservado (total de la empresa) en
 * sincronía, con el mismo patrón SELECT-FOR-UPDATE-luego-INSERT/UPDATE
 * que registrarMovimiento (por la misma razón: ON CONFLICT DO UPDATE
 * dispara el CHECK sobre el valor del INSERT aunque termine en UPDATE).
 */
async function registrarReserva(client, { productoId, almacenId, delta }) {
  if (!Number.isInteger(delta) || delta === 0) throw new Error('delta debe ser un entero distinto de cero.');

  try {
    const { rows: existentes } = await client.query(
      'SELECT stock_reservado FROM producto_stock WHERE producto_id = $1 AND almacen_id = $2 FOR UPDATE',
      [productoId, almacenId]
    );
    if (existentes[0]) {
      await client.query(
        'UPDATE producto_stock SET stock_reservado = stock_reservado + $1 WHERE producto_id = $2 AND almacen_id = $3',
        [delta, productoId, almacenId]
      );
    } else {
      await client.query(
        'INSERT INTO producto_stock (producto_id, almacen_id, stock, stock_reservado) VALUES ($1, $2, 0, $3)',
        [productoId, almacenId, delta]
      );
    }
  } catch (err) {
    if (err.code === '23514') {
      throw new ApiError(409, 'STOCK_INSUFICIENTE', `No se puede reservar más stock del disponible para el producto ${productoId} en este almacén.`, { producto_id: productoId, almacen_id: almacenId });
    }
    throw err;
  }

  await client.query('UPDATE productos SET stock_reservado = stock_reservado + $1 WHERE id = $2', [delta, productoId]);
}

module.exports = { registrarMovimiento, obtenerAlmacenPrincipal, disponibleEnAlmacen, registrarReserva };
