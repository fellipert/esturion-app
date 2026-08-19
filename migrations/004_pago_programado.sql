-- Migración incremental: permite programar la fecha de pago de un cliente sin registrar
-- un pago recibido. Ejecutar: cat migrations/004_pago_programado.sql | docker exec -i esturion-db psql -U esturion -d esturion_db

ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_schedule_only BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS note TEXT;
