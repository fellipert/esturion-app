const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

function ageFromBirthDate(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  const bd = new Date(birthDate);
  let age = today.getFullYear() - bd.getFullYear();
  const m = today.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
  return age;
}

function publicUser(row) {
  const base = {
    id: row.id,
    email: row.email,
    role: row.role,
    fullName: row.full_name,
    phone: row.phone,
    photoUrl: row.photo_url,
    createdAt: row.created_at,
  };
  base.client = {
    birthDate: row.birth_date || null,
    age: ageFromBirthDate(row.birth_date),
    eps: row.eps || null,
    personalContactPhone: row.personal_contact_phone || null,
    emergencyContactName: row.emergency_contact_name || null,
    emergencyContactPhone: row.emergency_contact_phone || null,
    emergencyContactRelationship: row.emergency_contact_relationship || null,
    medicalCondition: row.medical_condition || null,
    monthlyFee: row.monthly_fee != null ? Number(row.monthly_fee) : 180000,
    notes: row.notes || null,
    active: row.active !== false,
    hasBeneficiaries: row.has_beneficiaries === true,
  };
  return base;
}

const SELECT_WITH_CLIENT = `
  SELECT u.*, c.birth_date, c.eps, c.personal_contact_phone,
         c.emergency_contact_name, c.emergency_contact_phone, c.emergency_contact_relationship,
         c.medical_condition, c.monthly_fee, c.notes, c.active, c.has_beneficiaries
  FROM users u LEFT JOIN clients c ON c.user_id = u.id
`;

async function ensureClientRow(userId) {
  await pool.query(
    `INSERT INTO clients (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

// Mi perfil completo (incluye datos de cliente si aplica)
router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query(SELECT_WITH_CLIENT + ' WHERE u.id = $1', [req.user.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json({ user: publicUser(result.rows[0]) });
});

// Actualizar mi propio perfil (cualquier rol). Si soy cliente, también puedo
// actualizar mi contacto de emergencia (no mi cuota mensual, esa la fija la administración).
router.put('/me', requireAuth, async (req, res) => {
  const {
    fullName, phone, hasBeneficiaries,
    birthDate, eps, personalContactPhone,
    emergencyContactName, emergencyContactPhone, emergencyContactRelationship,
    medicalCondition,
  } = req.body;
  await pool.query(
    `UPDATE users SET full_name = COALESCE($1, full_name), phone = COALESCE($2, phone) WHERE id = $3`,
    [fullName || null, phone || null, req.user.id]
  );
  // La ficha personal (fecha de nacimiento, EPS, contacto de emergencia, etc.) aplica a
  // cualquier rol. "hasBeneficiaries" solo tiene sentido para clientes, pero no molesta
  // guardarlo igual si llega vacío.
  await ensureClientRow(req.user.id);
  const fields = [
    'birth_date = $1', 'eps = $2', 'personal_contact_phone = $3',
    'emergency_contact_name = $4', 'emergency_contact_phone = $5', 'emergency_contact_relationship = $6',
    'medical_condition = $7',
  ];
  const params = [
    birthDate || null, eps || null, personalContactPhone || null,
    emergencyContactName || null, emergencyContactPhone || null, emergencyContactRelationship || null,
    medicalCondition || null,
  ];
  if (typeof hasBeneficiaries === 'boolean') {
    fields.push(`has_beneficiaries = $${params.length + 1}`);
    params.push(hasBeneficiaries);
  }
  params.push(req.user.id);
  await pool.query(`UPDATE clients SET ${fields.join(', ')} WHERE user_id = $${params.length}`, params);
  const result = await pool.query(SELECT_WITH_CLIENT + ' WHERE u.id = $1', [req.user.id]);
  res.json({ user: publicUser(result.rows[0]) });
});

// Subir/actualizar mi foto de perfil (cualquier rol)
router.post('/me/photo', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
  const url = `/uploads/${req.file.filename}`;
  await pool.query('UPDATE users SET photo_url = $1 WHERE id = $2', [url, req.user.id]);
  const result = await pool.query(SELECT_WITH_CLIENT + ' WHERE u.id = $1', [req.user.id]);
  res.json({ user: publicUser(result.rows[0]) });
});

// Listar todos los usuarios: admin y super_admin ven toda la información
router.get('/', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const result = await pool.query(SELECT_WITH_CLIENT + ' ORDER BY u.role DESC, u.full_name ASC');
  res.json({ users: result.rows.map(publicUser) });
});

// Crear una cuenta directamente (admin, super_admin o cliente) — solo super_admin
router.post('/', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { email, password, fullName, phone, role, monthlyFee } = req.body;
  if (!email || !password || !fullName || !role) {
    return res.status(400).json({ error: 'Correo, contraseña, nombre y rol son obligatorios.' });
  }
  if (!['cliente', 'admin', 'super_admin'].includes(role)) {
    return res.status(400).json({ error: 'Rol inválido.' });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
  if (existing.rows.length) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, role, full_name, phone) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [cleanEmail, passwordHash, role, fullName, phone || null]
  );
  const user = result.rows[0];
  if (role === 'cliente') {
    await pool.query(
      `INSERT INTO clients (user_id, monthly_fee) VALUES ($1, $2)`,
      [user.id, monthlyFee || 180000]
    );
  }
  const full = await pool.query(SELECT_WITH_CLIENT + ' WHERE u.id = $1', [user.id]);
  res.status(201).json({ user: publicUser(full.rows[0]) });
});

// Cambiar el rol de un usuario — solo super_admin
router.put('/:id/role', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { role } = req.body;
  if (!['cliente', 'admin', 'super_admin'].includes(role)) {
    return res.status(400).json({ error: 'Rol inválido.' });
  }
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes cambiar tu propio rol.' });
  }
  const result = await pool.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING *', [role, req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (role === 'cliente') await ensureClientRow(req.params.id);
  const full = await pool.query(SELECT_WITH_CLIENT + ' WHERE u.id = $1', [req.params.id]);
  res.json({ user: publicUser(full.rows[0]) });
});

// Editar los datos de cualquier usuario (incluye cuota mensual si es cliente) — solo super_admin
router.put('/:id', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { fullName, phone, monthlyFee, emergencyContactName, emergencyContactPhone, active } = req.body;
  const result = await pool.query(
    `UPDATE users SET full_name = COALESCE($1, full_name), phone = COALESCE($2, phone) WHERE id = $3 RETURNING *`,
    [fullName || null, phone || null, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (result.rows[0].role === 'cliente') {
    await ensureClientRow(req.params.id);
    await pool.query(
      `UPDATE clients SET monthly_fee = COALESCE($1, monthly_fee),
       emergency_contact_name = COALESCE($2, emergency_contact_name),
       emergency_contact_phone = COALESCE($3, emergency_contact_phone),
       active = COALESCE($4, active)
       WHERE user_id = $5`,
      [monthlyFee || null, emergencyContactName || null, emergencyContactPhone || null, active, req.params.id]
    );
  }
  const full = await pool.query(SELECT_WITH_CLIENT + ' WHERE u.id = $1', [req.params.id]);
  res.json({ user: publicUser(full.rows[0]) });
});

// Eliminar una cuenta — solo super_admin
router.delete('/:id', requireAuth, requireRole('super_admin'), async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
  }
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Restablecer la contraseña de cualquier cuenta — solo super_admin.
// Si no se envía newPassword, se genera una aleatoria y se devuelve una única vez.
router.post('/:id/reset-password', requireAuth, requireRole('super_admin'), async (req, res) => {
  let { newPassword } = req.body;
  if (!newPassword || !newPassword.trim()) {
    newPassword = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 4).toUpperCase();
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const result = await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING email, full_name', [passwordHash, req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json({ newPassword, email: result.rows[0].email, fullName: result.rows[0].full_name });
});

module.exports = router;
