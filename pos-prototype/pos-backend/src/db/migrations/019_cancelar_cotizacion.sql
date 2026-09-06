-- =====================================================================
-- Migración 019: Estado "cancelada" real para cotizaciones
-- =====================================================================
-- Antes solo existía "rechazada" para cualquier cotización que no
-- prospera — sin distinguir si fue el CLIENTE quien la rechazó o el
-- NEGOCIO quien la anuló antes de tener respuesta (se equivocaron, ya
-- no aplica, etc.). Son motivos distintos y vale la pena que el
-- historial lo refleje.
-- =====================================================================

ALTER TYPE estado_cotizacion ADD VALUE 'cancelada';
