const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function publicBeneficiary(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    idType: row.id_type,
    idNumber: row.id_number,
    sex: row.sex,
  };
}

// Mis beneficiarios (cliente)
router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM beneficiaries WHERE client_user_id = $1 ORDER BY full_name ASC',
    [req.user.id]
  );
  res.json({ beneficiaries: result.rows.map(publicBeneficiary) });
});

// Agregar un beneficiario a mi cuenta (cliente)
router.post('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'cliente') return res.status(403).json({ error: 'Solo los clientes pueden tener beneficiarios.' });
  const { fullName, idType, idNumber, sex } = req.body;
  if (!fullName || !fullName.trim()) return res.status(400).json({ error: 'El nombre del beneficiario es obligatorio.' });
  const validIdType = ['CC', 'TI', 'CE', 'PASAPORTE', 'RC'].includes(idType) ? idType : 'CC';
  const validSex = ['masculino', 'femenino', 'otro'].includes(sex) ? sex : null;
  const result = await pool.query(
    `INSERT INTO beneficiaries (client_user_id, full_name, id_type, id_number, sex)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, fullName.trim(), validIdType, idNumber || null, validSex]
  );
  // Marca automáticamente que este cliente ya tiene beneficiarios activados
  await pool.query(
    `UPDATE clients SET has_beneficiaries = true WHERE user_id = $1`,
    [req.user.id]
  );
  res.status(201).json({ beneficiary: publicBeneficiary(result.rows[0]) });
});

// Eliminar un beneficiario propio (cliente)
router.delete('/:id', requireAuth, async (req, res) => {
  const result = await pool.query(
    'DELETE FROM beneficiaries WHERE id = $1 AND client_user_id = $2 RETURNING id',
    [req.params.id, req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Beneficiario no encontrado.' });
  res.json({ ok: true });
});

// Listar TODOS los beneficiarios del club, con el nombre de su cliente titular —
// admin y super_admin (para verlos en "Clientes" y en "Base de datos clientes").
router.get('/', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const result = await pool.query(`
    SELECT b.*, u.full_name AS client_name
    FROM beneficiaries b JOIN users u ON u.id = b.client_user_id
    ORDER BY u.full_name ASC, b.full_name ASC
  `);
  res.json({
    beneficiaries: result.rows.map(r => ({
      ...publicBeneficiary(r),
      clientUserId: r.client_user_id,
      clientName: r.client_name,
    })),
  });
});

// Ver los beneficiarios de un cliente específico — admin y super_admin
router.get('/:userId', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM beneficiaries WHERE client_user_id = $1 ORDER BY full_name ASC',
    [req.params.userId]
  );
  res.json({ beneficiaries: result.rows.map(publicBeneficiary) });
});

module.exports = router;
