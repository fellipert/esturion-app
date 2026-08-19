-- Migración incremental: Planes de pago + créditos de clases.
-- Ejecutar: cat migrations/005_planes_creditos.sql | docker exec -i esturion-db psql -U esturion -d esturion_db

CREATE TABLE IF NOT EXISTS credit_plans (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(60) NOT NULL,
  tariff_label   VARCHAR(60) NOT NULL DEFAULT 'Tarifas 2026',
  min_value      NUMERIC(10,2) NOT NULL,
  max_value      NUMERIC(10,2),
  credits        INTEGER NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT true,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS current_plan_id INTEGER REFERENCES credit_plans(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS credits_assigned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS credits_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cycle_start DATE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cycle_end DATE;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES credit_plans(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS credits_assigned INTEGER;

INSERT INTO credit_plans (name, tariff_label, min_value, max_value, credits, active)
SELECT * FROM (VALUES
  ('PLAN 4', 'Tarifas 2026', 90000::numeric, 120999::numeric, 4, true),
  ('PLAN 8', 'Tarifas 2026', 121000::numeric, 149999::numeric, 8, true),
  ('PLAN 16', 'Tarifas 2026', 150000::numeric, NULL::numeric, 16, true)
) AS v(name, tariff_label, min_value, max_value, credits, active)
WHERE NOT EXISTS (SELECT 1 FROM credit_plans);
