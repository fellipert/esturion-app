-- Migración incremental: agrega horarios semanales recurrentes sin borrar datos existentes.
-- Ejecutar: cat migrations/003_horarios_semanales.sql | docker exec -i esturion-db psql -U esturion -d esturion_db

CREATE TABLE IF NOT EXISTS class_schedules (
  id            SERIAL PRIMARY KEY,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    TIME NOT NULL,
  end_time      TIME,
  title         VARCHAR(150) NOT NULL DEFAULT 'Clase de natación',
  instructor    VARCHAR(120),
  schedule_type VARCHAR(20) NOT NULL DEFAULT 'regular' CHECK (schedule_type IN ('regular','opcional','extraordinaria')),
  recurring     BOOLEAN NOT NULL DEFAULT true,
  active        BOOLEAN NOT NULL DEFAULT true,
  start_date    DATE,
  end_date      DATE,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_class_preferences (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  preferred_schedule_id INTEGER REFERENCES class_schedules(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE classes ADD COLUMN IF NOT EXISTS schedule_id INTEGER REFERENCES class_schedules(id) ON DELETE SET NULL;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE classes ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'programada';

DO $$ BEGIN
  ALTER TABLE classes ADD CONSTRAINT classes_schedule_type_check CHECK (schedule_type IN ('regular','opcional','extraordinaria','manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE classes ADD CONSTRAINT classes_status_check CHECK (status IN ('programada','cancelada','finalizada'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_schedule_date ON classes(schedule_id, class_date) WHERE schedule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schedules_day ON class_schedules(day_of_week);
CREATE INDEX IF NOT EXISTS idx_schedules_active ON class_schedules(active);

INSERT INTO class_schedules (day_of_week, start_time, title, schedule_type, recurring, active, notes)
SELECT * FROM (VALUES
  (1::smallint, '18:30'::time, 'Clase de natación', 'regular', true, true, 'Lunes 6:30 p.m.'),
  (3::smallint, '05:00'::time, 'Clase de natación', 'regular', true, true, 'Miércoles 5:00 a.m.'),
  (5::smallint, '18:30'::time, 'Clase de natación', 'regular', true, true, 'Viernes 6:30 p.m.'),
  (6::smallint, '14:00'::time, 'Clase de natación', 'regular', true, true, 'Sábado 2:00 p.m.'),
  (6::smallint, '15:00'::time, 'Clase de natación', 'opcional', true, false, 'Sábado 3:00 p.m. — horario opcional'),
  (0::smallint, '09:00'::time, 'Clase de natación', 'opcional', true, false, 'Domingo — horario configurable por administración')
) AS v(day_of_week, start_time, title, schedule_type, recurring, active, notes)
WHERE NOT EXISTS (SELECT 1 FROM class_schedules);
