-- Migración incremental: día fijo de pago mensual por cliente.
-- Ejecutar: cat migrations/007_dia_pago_fijo.sql | docker exec -i esturion-db psql -U esturion -d esturion_db

ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_day SMALLINT;
DO $$ BEGIN
  ALTER TABLE clients ADD CONSTRAINT clients_payment_day_check CHECK (payment_day BETWEEN 1 AND 31);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
