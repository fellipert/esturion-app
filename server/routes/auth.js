const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Limita intentos de login para mitigar fuerza bruta
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' },
});

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    fullName: row.full_name,
    phone: row.phone,
    photoUrl: row.photo_url,
  };
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, fullName: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Registro público: siempre crea cuentas de rol "cliente".
// Las cuentas de admin/super_admin las crea el super administrador desde el panel de Socios.
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName, phone, inviteCode } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Nombre, correo y contraseña son obligatorios.' });
    }
    const codeRow = await pool.query("SELECT value FROM club_settings WHERE key = 'invite_code'");
    const validCode = codeRow.rows[0]?.value;
    if (validCode && String(inviteCode || '').trim().toUpperCase() !== String(validCode).trim().toUpperCase()) {
      return res.status(403).json({ error: 'Código de invitación inválido. Pídelo a la administración del club.' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) return res.status(400).json({ error: 'Correo inválido.' });
    if (password.length < 4) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres.' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, full_name, phone)
       VALUES ($1, $2, 'cliente', $3, $4) RETURNING *`,
      [cleanEmail, passwordHash, fullName, phone || null]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear la cuenta.' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Correo y contraseña requeridos.' });
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [String(email).trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo iniciar sesión.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json({ user: publicUser(result.rows[0]) });
});

// Recuperar contraseña sin correo: se valida con el código de invitación del club
// (más débil que un enlace por email, pero funcional mientras no haya SMTP configurado).
router.post('/reset-password', async (req, res) => {
  try {
    const { email, inviteCode, newPassword } = req.body;
    if (!email || !inviteCode || !newPassword) {
      return res.status(400).json({ error: 'Correo, código de invitación y nueva contraseña son obligatorios.' });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres.' });
    }
    const codeRow = await pool.query("SELECT value FROM club_settings WHERE key = 'invite_code'");
    const validCode = codeRow.rows[0]?.value;
    if (!validCode || String(inviteCode).trim().toUpperCase() !== String(validCode).trim().toUpperCase()) {
      return res.status(403).json({ error: 'Código de invitación incorrecto.' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
    if (!userRes.rows.length) return res.status(404).json({ error: 'No existe una cuenta con ese correo.' });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [passwordHash, cleanEmail]);
    const user = userRes.rows[0];
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo restablecer la contraseña.' });
  }
});

module.exports = router;
