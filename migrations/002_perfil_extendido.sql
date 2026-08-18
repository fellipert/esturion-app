-- Migración incremental: agrega los nuevos campos de perfil del cliente sin borrar datos existentes.
-- Ejecutar: cat migrations/002_perfil_extendido.sql | docker exec -i esturion-db psql -U esturion -d esturion_db

ALTER TABLE clients ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS eps VARCHAR(120);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS personal_contact_phone VARCHAR(30);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS emergency_contact_relationship VARCHAR(60);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS medical_condition TEXT;
