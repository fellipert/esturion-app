-- Migración incremental: cada beneficiario puede tener su propia configuración de pago
-- (valor, créditos, día de pago), igual que un cliente titular.
-- Ejecutar: cat migrations/008_pagos_beneficiarios.sql | docker exec -i esturion-db psql -U esturion -d esturion_db

ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS monthly_fee NUMERIC(10,2);
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS credits_assigned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS credits_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS cycle_start DATE;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS cycle_end DATE;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS payment_day SMALLINT;
DO $$ BEGIN
  ALTER TABLE beneficiaries ADD CONSTRAINT beneficiaries_payment_day_check CHECK (payment_day BETWEEN 1 AND 31);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS beneficiary_id INTEGER REFERENCES beneficiaries(id) ON DELETE CASCADE;
