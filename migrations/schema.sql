-- Esquema de base de datos — Club Esturión (Fase 1: cartera, asistencia real, mensajería)
-- Ejecutar como: psql -U esturion -d esturion_db -f migrations/schema.sql
--
-- Roles:
--   super_admin  -> control total: gestiona clases, socios, administradores y el logo/ajustes del club
--   admin        -> ve toda la información del club (clientes, asistencia, cartera) y registra pagos,
--                   pero no puede crear/editar/eliminar clases ni gestionar cuentas de usuario
--   cliente      -> visualiza clases, confirma su asistencia y ve su propia mensualidad
--
-- Arquitectura: "users" guarda credenciales/rol (autenticación), "clients" guarda el perfil
-- deportivo/financiero extendido de quienes tienen role='cliente'. Esto evita mezclar seguridad
-- con datos de negocio y facilita agregar más tipos de perfil (instructores, etc.) más adelante.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(160) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'cliente' CHECK (role IN ('cliente','admin','super_admin')),
  full_name     VARCHAR(120) NOT NULL,
  phone         VARCHAR(30),
  photo_url     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Perfil extendido, solo para usuarios con role = 'cliente'
CREATE TABLE IF NOT EXISTS clients (
  user_id                 INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  emergency_contact_name  VARCHAR(120),
  emergency_contact_phone VARCHAR(30),
  monthly_fee             NUMERIC(10,2) NOT NULL DEFAULT 180000,
  notes                   TEXT,
  active                  BOOLEAN NOT NULL DEFAULT true,
  has_beneficiaries       BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Beneficiarios de un cliente (hijos, familiares, etc.) que pueden reservar clases
-- bajo la cuenta del cliente titular, sin tener su propio login.
CREATE TABLE IF NOT EXISTS beneficiaries (
  id             SERIAL PRIMARY KEY,
  client_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name      VARCHAR(120) NOT NULL,
  id_type        VARCHAR(20) NOT NULL DEFAULT 'CC' CHECK (id_type IN ('CC','TI','CE','PASAPORTE','RC')),
  id_number      VARCHAR(40),
  sex            VARCHAR(20) CHECK (sex IN ('masculino','femenino','otro')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS classes (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(150) NOT NULL,
  class_date    DATE NOT NULL,
  class_time    TIME NOT NULL,
  instructor    VARCHAR(120),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "confirmed" = se reservó/confirmó que va a ir. "attended" = lo que realmente pasó, lo marca
-- un admin después de la clase (NULL = aún sin marcar). "beneficiary_id" NULL = la reserva es
-- del propio cliente (titular); si tiene valor, es la reserva de ese beneficiario específico.
CREATE TABLE IF NOT EXISTS attendance (
  id                SERIAL PRIMARY KEY,
  class_id          INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  beneficiary_id    INTEGER REFERENCES beneficiaries(id) ON DELETE CASCADE,
  confirmed         BOOLEAN NOT NULL DEFAULT true,
  confirmed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  attended          BOOLEAN,
  attended_marked_at TIMESTAMPTZ
);
-- Único por clase + cuenta + persona (titular o beneficiario). COALESCE evita duplicados del titular.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique
  ON attendance(class_id, user_id, COALESCE(beneficiary_id, 0));

CREATE TABLE IF NOT EXISTS payments (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount        NUMERIC(10,2),
  method        VARCHAR(30) DEFAULT 'transferencia' CHECK (method IN ('transferencia','nequi','efectivo','tarjeta','otro')),
  months        INTEGER NOT NULL DEFAULT 1,
  paid_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date      DATE NOT NULL,
  registered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mensajería interna: individual (recipient_user_id), por clase (recipient_class_id),
-- o general (ambos NULL = todos los clientes del club).
CREATE TABLE IF NOT EXISTS messages (
  id                 SERIAL PRIMARY KEY,
  sender_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  scope              VARCHAR(20) NOT NULL CHECK (scope IN ('individual','clase','general')),
  recipient_user_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
  recipient_class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  body               TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS club_settings (
  key   VARCHAR(50) PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_attendance_class ON attendance(class_id);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_beneficiaries_client ON beneficiaries(client_user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_classes_date ON classes(class_date);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_user ON messages(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_class ON messages(recipient_class_id);

-- Cuentas iniciales solicitadas.
INSERT INTO users (email, password_hash, role, full_name) VALUES
  ('djandre0988@gmail.com', '$2a$10$oWqTr8fUVXloSTxx0bGa0O2CTcUEQ59y0sdbZnHWsN/OBUpSV82nm', 'super_admin', 'Andrés Tovar Agudelo'),
  ('maria_camigo4@hotmail.com', '$2a$10$PsTX3U2JNZVwKSibnwo3H.ID204jvnOs9XTmDSdUs8/hFIsoZTa6u', 'admin', 'María Camigo'),
  ('susigonzalezbetancur.25@gmail.com', '$2a$10$PsTX3U2JNZVwKSibnwo3H.ID204jvnOs9XTmDSdUs8/hFIsoZTa6u', 'admin', 'Susi González Betancur')
ON CONFLICT (email) DO NOTHING;

-- Código de invitación inicial para el registro de clientes. Cámbialo desde "Socios" (súper admin).
INSERT INTO club_settings (key, value) VALUES ('invite_code', 'ESTURION2026')
ON CONFLICT (key) DO NOTHING;
