-- =====================================================================
-- Migración 010: multi-almacén real en ventas y pedidos (Fase 10)
-- =====================================================================
-- Hasta ahora, toda venta/pedido descontaba/reservaba SIEMPRE del
-- almacén principal, aunque la empresa tuviera varios (Fase 5). Esto le
-- da a cada venta y pedido un almacen_id explícito — de dónde sale la
-- mercadería — y hace que la reserva de un pedido viva en
-- producto_stock.stock_reservado (por almacén), no solo en el total de
-- la empresa (productos.stock_reservado), que se mantiene en sincronía
-- igual que ya hace kardex.service.js con productos.stock.
--
-- Las filas existentes se migran al almacén principal de cada empresa —
-- nada cambia para quien solo tenía uno.
-- =====================================================================

BEGIN;

ALTER TABLE ventas ADD COLUMN almacen_id BIGINT REFERENCES almacenes(id) ON DELETE RESTRICT;
ALTER TABLE pedidos ADD COLUMN almacen_id BIGINT REFERENCES almacenes(id) ON DELETE RESTRICT;

UPDATE ventas v SET almacen_id = (
  SELECT a.id FROM almacenes a WHERE a.company_id = v.company_id AND a.es_principal LIMIT 1
) WHERE almacen_id IS NULL;

UPDATE pedidos p SET almacen_id = (
  SELECT a.id FROM almacenes a WHERE a.company_id = p.company_id AND a.es_principal LIMIT 1
) WHERE almacen_id IS NULL;

ALTER TABLE ventas ALTER COLUMN almacen_id SET NOT NULL;
ALTER TABLE pedidos ALTER COLUMN almacen_id SET NOT NULL;

CREATE INDEX idx_ventas_almacen ON ventas (almacen_id);
CREATE INDEX idx_pedidos_almacen ON pedidos (almacen_id);

COMMIT;
