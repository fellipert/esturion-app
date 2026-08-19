const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function statusFromDueDate(dueDate) {
  if (!dueDate) return { label: 'Sin registro', status: 'warn', dueDate: null };
  const today = new Date().toISOString().slice(0, 10);
  const diffDays = Math.round((new Date(dueDate) - new Date(today)) / 86400000);
  if (diffDays < 0) return { label: 'Vencida', status: 'bad', dueDate, diffDays };
  if (diffDays <= 2) return { label: 'Por vencer', status: 'warn', dueDate, diffDays };
  return { label: 'Al día', status: 'ok', dueDate, diffDays };
}

const METHOD_LABEL = { transferencia: 'Transferencia', nequi: 'Nequi', efectivo: 'Efectivo', tarjeta: 'Tarjeta', otro: 'Otro' };

// Mi estado de mensualidad + historial (cualquier rol autenticado ve lo suyo)
router.get('/me', requireAuth, async (req, res) => {
  const dueRes = await pool.query(
    'SELECT due_date FROM payments WHERE user_id = $1 ORDER BY due_date DESC LIMIT 1',
    [req.user.id]
  );
  const historyRes = await pool.query(
    'SELECT amount, method, months, paid_at, due_date, is_schedule_only, note FROM payments WHERE user_id = $1 ORDER BY paid_at DESC, id DESC',
    [req.user.id]
  );
  const dueDate = dueRes.rows[0]?.due_date || null;
  res.json({
    status: statusFromDueDate(dueDate),
    history: historyRes.rows.map(h => ({ ...h, methodLabel: METHOD_LABEL[h.method] || h.method })),
  });
});

// Estado de mensualidad de todos los clientes + alertas — admin y super_admin
router.get('/', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const result = await pool.query(`
    SELECT u.id, u.full_name, u.email, COALESCE(c.monthly_fee, 180000) AS monthly_fee,
      (SELECT due_date FROM payments p WHERE p.user_id = u.id ORDER BY due_date DESC LIMIT 1) AS due_date
    FROM users u LEFT JOIN clients c ON c.user_id = u.id
    WHERE u.role = 'cliente' ORDER BY u.full_name ASC
  `);
  const members = result.rows.map(r => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    monthlyFee: Number(r.monthly_fee),
    ...statusFromDueDate(r.due_date),
  }));
  const alerts = members.filter(m => m.status !== 'ok');
  res.json({ members, alerts });
});

// Panel de cartera — admin y super_admin
router.get('/cartera', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const result = await pool.query(`
    SELECT u.id, u.full_name, COALESCE(c.monthly_fee, 180000) AS monthly_fee, COALESCE(c.active, true) AS active,
      (SELECT due_date FROM payments p WHERE p.user_id = u.id ORDER BY due_date DESC LIMIT 1) AS due_date
    FROM users u LEFT JOIN clients c ON c.user_id = u.id
    WHERE u.role = 'cliente'
  `);
  let alDia = 0, pendientes = 0, morosos = 0, carteraTotal = 0;
  const clientesActivos = result.rows.filter(r => r.active).length;
  const morososList = [];
  result.rows.forEach(r => {
    const st = statusFromDueDate(r.due_date);
    if (st.status === 'ok') alDia++;
    else if (st.status === 'warn') pendientes++;
    else if (st.status === 'bad') {
      morosos++;
      const fee = Number(r.monthly_fee);
      carteraTotal += fee;
      morososList.push({ id: r.id, fullName: r.full_name, dueDate: r.due_date, saldo: fee });
    }
  });
  morososList.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  res.json({
    clientesActivos,
    alDia,
    pendientes,
    morosos,
    carteraTotal,
    morososList,
  });
});

// Registrar un pago — admin y super_admin (tarea operativa, no estructural)
router.post('/', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { userId, months, amount, method } = req.body;
  if (!userId || !months) return res.status(400).json({ error: 'Cliente y meses son obligatorios.' });
  const validMethod = ['transferencia', 'nequi', 'efectivo', 'tarjeta', 'otro'].includes(method) ? method : 'transferencia';

  const lastDue = await pool.query(
    'SELECT due_date FROM payments WHERE user_id = $1 ORDER BY due_date DESC LIMIT 1',
    [userId]
  );
  const today = new Date().toISOString().slice(0, 10);
  const base = lastDue.rows[0] && lastDue.rows[0].due_date >= today ? lastDue.rows[0].due_date : today;
  const dueDate = new Date(base);
  dueDate.setDate(dueDate.getDate() + 30 * Number(months));
  const dueDateStr = dueDate.toISOString().slice(0, 10);

  const result = await pool.query(
    `INSERT INTO payments (user_id, amount, method, months, due_date, registered_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [userId, amount || null, validMethod, months, dueDateStr, req.user.id]
  );
  res.status(201).json({ payment: result.rows[0] });
});

// Programar (fijar) la próxima fecha de pago de un cliente específico, sin registrar un pago
// recibido — útil para dar a cada cliente una fecha de corte distinta. Admin y super_admin.
router.post('/schedule', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { userId, dueDate, note } = req.body;
  if (!userId || !dueDate) return res.status(400).json({ error: 'Cliente y fecha son obligatorios.' });
  const result = await pool.query(
    `INSERT INTO payments (user_id, amount, method, months, due_date, is_schedule_only, note, registered_by)
     VALUES ($1, NULL, NULL, 0, $2, true, $3, $4) RETURNING *`,
    [userId, dueDate, note || null, req.user.id]
  );
  res.status(201).json({ payment: result.rows[0] });
});

// Listado de programaciones de fecha de pago (registros solo de programación, sin pago
// recibido) — admin y super_admin, para ver a quién se le programó qué fecha.
router.get('/scheduled', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const result = await pool.query(`
    SELECT p.id, p.user_id, u.full_name, p.due_date, p.note, p.paid_at, p.created_at
    FROM payments p JOIN users u ON u.id = p.user_id
    WHERE p.is_schedule_only = true
    ORDER BY p.created_at DESC
  `);
  res.json({
    scheduled: result.rows.map(r => ({
      id: r.id, userId: r.user_id, fullName: r.full_name, dueDate: r.due_date, note: r.note, createdAt: r.created_at,
    })),
  });
});

// Editar una programación existente — admin y super_admin
router.put('/schedule/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { dueDate, note } = req.body;
  const result = await pool.query(
    `UPDATE payments SET due_date = COALESCE($1, due_date), note = $2
     WHERE id = $3 AND is_schedule_only = true RETURNING *`,
    [dueDate || null, note || null, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Programación no encontrada.' });
  res.json({ payment: result.rows[0] });
});

// Eliminar una programación — admin y super_admin
router.delete('/schedule/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  await pool.query(`DELETE FROM payments WHERE id = $1 AND is_schedule_only = true`, [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
