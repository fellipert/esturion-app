const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function publicPlan(row) {
  return {
    id: row.id,
    name: row.name,
    tariffLabel: row.tariff_label,
    minValue: Number(row.min_value),
    maxValue: row.max_value != null ? Number(row.max_value) : null,
    credits: row.credits,
    active: row.active,
    effectiveFrom: row.effective_from,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name || null,
  };
}

// Listar planes (admin y super_admin ven todos, incluidos inactivos; para elegir al registrar
// un pago cualquier autenticado puede consultar los activos)
router.get('/', requireAuth, async (req, res) => {
  const isStaff = ['admin', 'super_admin'].includes(req.user.role);
  const result = await pool.query(`
    SELECT p.*, u.full_name AS updated_by_name
    FROM credit_plans p LEFT JOIN users u ON u.id = p.updated_by
    ${isStaff ? '' : 'WHERE p.active = true'}
    ORDER BY p.tariff_label DESC, p.min_value ASC
  `);
  res.json({ plans: result.rows.map(publicPlan) });
});

// Sugerir un plan según el valor pagado
router.get('/suggest', requireAuth, async (req, res) => {
  const value = Number(req.query.value);
  if (!value || value <= 0) return res.status(400).json({ error: 'Valor inválido.' });
  const result = await pool.query(
    `SELECT * FROM credit_plans
     WHERE active = true AND min_value <= $1 AND (max_value IS NULL OR max_value >= $1)
     ORDER BY min_value DESC LIMIT 1`,
    [value]
  );
  if (!result.rows.length) {
    return res.json({ plan: null, message: 'El valor registrado no corresponde a ningún plan de créditos configurado.' });
  }
  res.json({ plan: publicPlan(result.rows[0]) });
});

// Crear un plan nuevo — admin y super_admin
router.post('/', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { name, tariffLabel, minValue, maxValue, credits, effectiveFrom, active } = req.body;
  if (!name || minValue === undefined || minValue === null || !credits) {
    return res.status(400).json({ error: 'Nombre, valor mínimo y créditos son obligatorios.' });
  }
  const result = await pool.query(
    `INSERT INTO credit_plans (name, tariff_label, min_value, max_value, credits, active, effective_from, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
    [name, tariffLabel || 'Tarifas 2026', minValue, maxValue || null, credits, active !== false, effectiveFrom || new Date().toISOString().slice(0,10), req.user.id]
  );
  res.status(201).json({ plan: publicPlan(result.rows[0]) });
});

// Editar un plan — admin y super_admin
router.put('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { name, tariffLabel, minValue, maxValue, credits, effectiveFrom } = req.body;
  const result = await pool.query(
    `UPDATE credit_plans SET
       name = COALESCE($1, name),
       tariff_label = COALESCE($2, tariff_label),
       min_value = COALESCE($3, min_value),
       max_value = $4,
       credits = COALESCE($5, credits),
       effective_from = COALESCE($6, effective_from),
       updated_by = $7,
       updated_at = now()
     WHERE id = $8 RETURNING *`,
    [name || null, tariffLabel || null, minValue ?? null, maxValue === undefined ? null : maxValue, credits || null, effectiveFrom || null, req.user.id, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Plan no encontrado.' });
  res.json({ plan: publicPlan(result.rows[0]) });
});

// Activar/desactivar un plan — admin y super_admin (no se elimina, se conserva el historial)
router.put('/:id/toggle', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const current = await pool.query('SELECT active FROM credit_plans WHERE id = $1', [req.params.id]);
  if (!current.rows.length) return res.status(404).json({ error: 'Plan no encontrado.' });
  const result = await pool.query(
    'UPDATE credit_plans SET active = $1, updated_by = $2, updated_at = now() WHERE id = $3 RETURNING *',
    [!current.rows[0].active, req.user.id, req.params.id]
  );
  res.json({ plan: publicPlan(result.rows[0]) });
});

module.exports = router;
