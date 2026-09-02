-- La dirección del cliente nunca se guardaba en el comprobante (solo tipo/
-- número/razón social) — el PDF no la podía mostrar aunque el cliente sí
-- la tuviera registrada. Se agrega como snapshot, igual que los otros
-- datos de cliente_*, para que el comprobante quede fijo aunque el
-- cliente cambie su dirección después.
ALTER TABLE comprobantes_electronicos ADD COLUMN IF NOT EXISTS cliente_direccion VARCHAR(300);
