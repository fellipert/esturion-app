-- Migración incremental: agrega fecha de nacimiento a los beneficiarios.
-- Ejecutar: cat migrations/006_beneficiario_fecha_nacimiento.sql | docker exec -i esturion-db psql -U esturion -d esturion_db

ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS birth_date DATE;
