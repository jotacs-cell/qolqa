-- Una venta a crédito (ventas.estado_pago = 'pendiente') no tenía ninguna
-- fecha límite de cobro — Cuentas por cobrar solo mostraba el total
-- pendiente, sin poder distinguir una deuda recién generada de una ya
-- vencida. Se agrega fecha_vencimiento (calculada al registrar la venta
-- como fecha + días de crédito indicados) para poder marcar "vencida".
ALTER TABLE ventas ADD COLUMN fecha_vencimiento DATE;
