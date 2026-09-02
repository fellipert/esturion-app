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

// Mi estado de mensualidad + historial (cliente, siempre lo propio del titular, no de beneficiarios)
router.get('/me', requireAuth, async (req, res) => {
  const dueRes = await pool.query(
    'SELECT due_date FROM payments WHERE user_id = $1 AND beneficiary_id IS NULL ORDER BY created_at DESC LIMIT 1',
    [req.user.id]
  );
  const historyRes = await pool.query(
    `SELECT amount, method, months, paid_at, due_date, is_schedule_only, note
     FROM payments WHERE user_id = $1 AND beneficiary_id IS NULL ORDER BY paid_at DESC, id DESC`,
    [req.user.id]
  );
  const dueDate = dueRes.rows[0]?.due_date || null;
  res.json({
    status: statusFromDueDate(dueDate),
    history: historyRes.rows.map(h => ({ ...h, methodLabel: METHOD_LABEL[h.method] || h.method })),
  });
});

// Estado de mensualidad de todos los clientes Y beneficiarios + alertas — admin y super_admin
router.get('/', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const clientsRes = await pool.query(`
    SELECT u.id, u.full_name, u.email, COALESCE(c.monthly_fee, 180000) AS monthly_fee,
      (SELECT due_date FROM payments p WHERE p.user_id = u.id AND p.beneficiary_id IS NULL ORDER BY created_at DESC LIMIT 1) AS due_date,
      (SELECT paid_at FROM payments p WHERE p.user_id = u.id AND p.beneficiary_id IS NULL ORDER BY created_at DESC LIMIT 1) AS paid_at
    FROM users u LEFT JOIN clients c ON c.user_id = u.id
    WHERE u.role = 'cliente' ORDER BY u.full_name ASC
  `);
  const benRes = await pool.query(`
    SELECT b.id, b.full_name, b.client_user_id, u.full_name AS parent_name, COALESCE(b.monthly_fee, 0) AS monthly_fee,
      (SELECT due_date FROM payments p WHERE p.beneficiary_id = b.id ORDER BY created_at DESC LIMIT 1) AS due_date,
      (SELECT paid_at FROM payments p WHERE p.beneficiary_id = b.id ORDER BY created_at DESC LIMIT 1) AS paid_at
    FROM beneficiaries b JOIN users u ON u.id = b.client_user_id
    ORDER BY u.full_name ASC, b.full_name ASC
  `);
  const members = clientsRes.rows.map(r => ({
    id: r.id,
    kind: 'client',
    fullName: r.full_name,
    email: r.email,
    monthlyFee: Number(r.monthly_fee),
    currentPaymentDate: r.paid_at || null,
    ...statusFromDueDate(r.due_date),
  }));
  const beneficiaryMembers = benRes.rows.map(r => ({
    id: r.id,
    kind: 'beneficiary',
    parentUserId: r.client_user_id,
    fullName: `${r.full_name} (beneficiario de ${r.parent_name})`,
    email: null,
    monthlyFee: Number(r.monthly_fee) || 0,
    currentPaymentDate: r.paid_at || null,
    ...statusFromDueDate(r.due_date),
  }));
  const all = [...members, ...beneficiaryMembers];
  const alerts = all.filter(m => m.status !== 'ok');
  res.json({ members: all, alerts });
});

// Panel de cartera — admin y super_admin (incluye clientes y beneficiarios)
router.get('/cartera', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const clientsRes = await pool.query(`
    SELECT u.id, u.full_name, COALESCE(c.monthly_fee, 180000) AS monthly_fee, COALESCE(c.active, true) AS active,
      (SELECT due_date FROM payments p WHERE p.user_id = u.id AND p.beneficiary_id IS NULL ORDER BY created_at DESC LIMIT 1) AS due_date
    FROM users u LEFT JOIN clients c ON c.user_id = u.id
    WHERE u.role = 'cliente'
  `);
  const benRes = await pool.query(`
    SELECT b.id, b.full_name, u.full_name AS parent_name, COALESCE(b.monthly_fee, 0) AS monthly_fee,
      (SELECT due_date FROM payments p WHERE p.beneficiary_id = b.id ORDER BY created_at DESC LIMIT 1) AS due_date
    FROM beneficiaries b JOIN users u ON u.id = b.client_user_id
  `);
  let alDia = 0, pendientes = 0, morosos = 0, carteraTotal = 0;
  const clientesActivos = clientsRes.rows.filter(r => r.active).length;
  const morososList = [];
  clientsRes.rows.forEach(r => {
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
  benRes.rows.forEach(r => {
    const st = statusFromDueDate(r.due_date);
    if (st.status === 'ok') alDia++;
    else if (st.status === 'warn') pendientes++;
    else if (st.status === 'bad') {
      morosos++;
      const fee = Number(r.monthly_fee) || 0;
      carteraTotal += fee;
      morososList.push({ id: r.id, fullName: `${r.full_name} (beneficiario de ${r.parent_name})`, dueDate: r.due_date, saldo: fee });
    }
  });
  morososList.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  res.json({ clientesActivos, alDia, pendientes, morosos, carteraTotal, morososList });
});

// Registrar un pago — admin y super_admin. Puede ser para el titular (sin beneficiaryId)
// o para un beneficiario específico (con beneficiaryId) — cada uno con su propio ciclo.
router.post('/', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { userId, beneficiaryId, months, amount, method, planId, creditsAssigned, paidAt } = req.body;
  if (!userId || !months) return res.status(400).json({ error: 'Cliente y meses son obligatorios.' });
  const validMethod = ['transferencia', 'nequi', 'efectivo', 'tarjeta', 'otro'].includes(method) ? method : 'transferencia';
  const paidDateStr = paidAt || new Date().toISOString().slice(0, 10);
  const targetTable = beneficiaryId ? 'beneficiaries' : 'clients';
  const targetIdCol = beneficiaryId ? 'id' : 'user_id';
  const targetIdVal = beneficiaryId || userId;

  // Día fijo de pago (del titular o del beneficiario, según corresponda). Es la base fija:
  // la próxima fecha SIEMPRE cae ese día, sin importar cuándo pagó esta vez. Solo si nunca ha
  // sido configurado, se toma el día de este primer pago y queda fijado para el futuro.
  const targetRow = await pool.query(`SELECT payment_day FROM ${targetTable} WHERE ${targetIdCol} = $1`, [targetIdVal]);
  let paymentDay = targetRow.rows[0]?.payment_day || null;
  const isFirstEverPaymentDay = !paymentDay;
  if (!paymentDay) paymentDay = Number(paidDateStr.slice(8, 10));

  const dueDateObj = new Date(paidDateStr + 'T00:00:00');
  dueDateObj.setMonth(dueDateObj.getMonth() + Number(months));
  const lastDayOfMonth = new Date(dueDateObj.getFullYear(), dueDateObj.getMonth() + 1, 0).getDate();
  dueDateObj.setDate(Math.min(paymentDay, lastDayOfMonth));
  const dueDateStr = dueDateObj.toISOString().slice(0, 10);

  const cycleEndObj = new Date(dueDateObj);
  cycleEndObj.setDate(cycleEndObj.getDate() - 1);
  const cycleEndStr = cycleEndObj.toISOString().slice(0, 10);

  const result = await pool.query(
    `INSERT INTO payments (user_id, beneficiary_id, amount, method, months, paid_at, due_date, plan_id, credits_assigned, registered_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [userId, beneficiaryId || null, amount || null, validMethod, months, paidDateStr, dueDateStr, planId || null, creditsAssigned || null, req.user.id]
  );

  // Registrar un pago SOLO avanza las fechas del ciclo. El valor a pagar, los créditos
  // asignados y el día fijo de pago son la configuración base (definida en "Conf. Clientes")
  // y no se tocan aquí — así queda predeterminada de verdad, sea del titular o del beneficiario.
  const fields = ['cycle_start = $1', 'cycle_end = $2'];
  const params = [paidDateStr, cycleEndStr];
  if (isFirstEverPaymentDay) {
    fields.push(`payment_day = $${params.length + 1}`);
    params.push(paymentDay);
  }
  params.push(targetIdVal);
  await pool.query(`UPDATE ${targetTable} SET ${fields.join(', ')} WHERE ${targetIdCol} = $${params.length}`, params);

  res.status(201).json({ payment: result.rows[0] });
});

// Programar (fijar) la próxima fecha de pago — de un cliente titular, o de un beneficiario
// específico si se envía beneficiaryId. Sin registrar un pago recibido. Admin y super_admin.
router.post('/schedule', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { userId, beneficiaryId, dueDate, note, planId, creditsAssigned, amount } = req.body;
  if (!userId || !dueDate) return res.status(400).json({ error: 'Cliente y fecha son obligatorios.' });
  const targetTable = beneficiaryId ? 'beneficiaries' : 'clients';
  const targetIdCol = beneficiaryId ? 'id' : 'user_id';
  const targetIdVal = beneficiaryId || userId;

  const result = await pool.query(
    `INSERT INTO payments (user_id, beneficiary_id, amount, method, months, due_date, is_schedule_only, note, plan_id, credits_assigned, registered_by)
     VALUES ($1, $2, $3, NULL, 0, $4, true, $5, $6, $7, $8) RETURNING *`,
    [userId, beneficiaryId || null, amount || null, dueDate, note || null, planId || null, creditsAssigned || null, req.user.id]
  );

  const cycleEndObj = new Date(dueDate + 'T00:00:00');
  cycleEndObj.setDate(cycleEndObj.getDate() - 1);
  const cycleEndStr = cycleEndObj.toISOString().slice(0, 10);

  const fields = ['cycle_start = CURRENT_DATE', 'cycle_end = $1', 'payment_day = $2'];
  const params = [cycleEndStr, Number(dueDate.slice(8, 10))];
  if (amount) {
    fields.push(`monthly_fee = $${params.length + 1}`);
    params.push(amount);
  }
  if (creditsAssigned) {
    if (!beneficiaryId) {
      fields.push(`current_plan_id = $${params.length + 1}`);
      params.push(planId || null);
    }
    fields.push(`credits_assigned = $${params.length + 1}`);
    params.push(creditsAssigned);
    fields.push('credits_used = 0');
  }
  params.push(targetIdVal);
  await pool.query(`UPDATE ${targetTable} SET ${fields.join(', ')} WHERE ${targetIdCol} = $${params.length}`, params);

  res.status(201).json({ payment: result.rows[0] });
});

// Listado de programaciones (registros solo de programación) — admin y super_admin
router.get('/scheduled', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const result = await pool.query(`
    SELECT p.id, p.user_id, u.full_name, p.beneficiary_id, b.full_name AS beneficiary_name,
           p.due_date, p.note, p.paid_at, p.created_at, p.amount, cp.name AS plan_name
    FROM payments p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN beneficiaries b ON b.id = p.beneficiary_id
    LEFT JOIN credit_plans cp ON cp.id = p.plan_id
    WHERE p.is_schedule_only = true
    ORDER BY p.created_at DESC
  `);
  res.json({
    scheduled: result.rows.map(r => ({
      id: r.id, userId: r.user_id,
      fullName: r.beneficiary_name ? `${r.beneficiary_name} (beneficiario de ${r.full_name})` : r.full_name,
      dueDate: r.due_date, note: r.note, createdAt: r.created_at,
      amount: r.amount != null ? Number(r.amount) : null, planName: r.plan_name || null,
    })),
  });
});

// Editar una programación existente — admin y super_admin
router.put('/schedule/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { dueDate, note, amount } = req.body;
  const result = await pool.query(
    `UPDATE payments SET due_date = COALESCE($1, due_date), note = $2, amount = $3
     WHERE id = $4 AND is_schedule_only = true RETURNING *`,
    [dueDate || null, note || null, amount || null, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Programación no encontrada.' });
  res.json({ payment: result.rows[0] });
});

// Eliminar una programación — admin y super_admin
router.delete('/schedule/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  await pool.query(`DELETE FROM payments WHERE id = $1 AND is_schedule_only = true`, [req.params.id]);
  res.json({ ok: true });
});

// Mis créditos, plan y ciclo actual (cliente titular), con historial de clases consumidas
router.get('/credits/me', requireAuth, async (req, res) => {
  const clientRes = await pool.query(
    `SELECT c.*, p.name AS plan_name, p.credits AS plan_credits
     FROM clients c LEFT JOIN credit_plans p ON p.id = c.current_plan_id
     WHERE c.user_id = $1`,
    [req.user.id]
  );
  const cl = clientRes.rows[0];
  const historyRes = await pool.query(
    `SELECT cls.title, cls.class_date, cls.class_time, a.confirmed_at, b.full_name AS beneficiary_name
     FROM attendance a
     JOIN classes cls ON cls.id = a.class_id
     LEFT JOIN beneficiaries b ON b.id = a.beneficiary_id
     WHERE a.user_id = $1 AND a.confirmed = true
     ORDER BY cls.class_date DESC, cls.class_time DESC LIMIT 30`,
    [req.user.id]
  );
  res.json({
    planName: cl?.plan_name || null,
    creditsAssigned: cl?.credits_assigned || 0,
    creditsUsed: cl?.credits_used || 0,
    creditsAvailable: Math.max(0, (cl?.credits_assigned || 0) - (cl?.credits_used || 0)),
    cycleStart: cl?.cycle_start || null,
    cycleEnd: cl?.cycle_end || null,
    history: historyRes.rows.map(h => ({
      title: h.title, date: h.class_date, time: h.class_time,
      consumedAt: h.confirmed_at, beneficiaryName: h.beneficiary_name || null,
    })),
  });
});

// Eliminar/reiniciar el registro de pagos de un cliente titular — la cuenta NO se toca.
router.delete('/reset/:userId', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  await pool.query('DELETE FROM payments WHERE user_id = $1 AND beneficiary_id IS NULL', [req.params.userId]);
  await pool.query(
    `UPDATE clients SET current_plan_id = NULL, credits_assigned = 0, credits_used = 0,
     cycle_start = NULL, cycle_end = NULL, payment_day = NULL, monthly_fee = 180000 WHERE user_id = $1`,
    [req.params.userId]
  );
  res.json({ ok: true });
});

// Eliminar/reiniciar el registro de pagos de un beneficiario específico.
router.delete('/reset-beneficiary/:beneficiaryId', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  await pool.query('DELETE FROM payments WHERE beneficiary_id = $1', [req.params.beneficiaryId]);
  await pool.query(
    `UPDATE beneficiaries SET credits_assigned = 0, credits_used = 0,
     cycle_start = NULL, cycle_end = NULL, payment_day = NULL, monthly_fee = NULL WHERE id = $1`,
    [req.params.beneficiaryId]
  );
  res.json({ ok: true });
});

// Historial completo de pagos de un cliente titular específico — admin y super_admin
router.get('/history/:userId', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const userRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [req.params.userId]);
  if (!userRes.rows.length) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const historyRes = await pool.query(
    `SELECT paid_at, due_date, amount, method, months, is_schedule_only, note
     FROM payments WHERE user_id = $1 AND beneficiary_id IS NULL ORDER BY paid_at DESC, id DESC`,
    [req.params.userId]
  );
  res.json({
    fullName: userRes.rows[0].full_name,
    history: historyRes.rows.map(h => ({
      ...h,
      amount: h.amount != null ? Number(h.amount) : null,
      methodLabel: METHOD_LABEL[h.method] || h.method || null,
    })),
  });
});

// Historial completo de pagos de un beneficiario específico — admin y super_admin
router.get('/history-beneficiary/:beneficiaryId', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const benRes = await pool.query(
    `SELECT b.full_name, u.full_name AS parent_name FROM beneficiaries b JOIN users u ON u.id = b.client_user_id WHERE b.id = $1`,
    [req.params.beneficiaryId]
  );
  if (!benRes.rows.length) return res.status(404).json({ error: 'Beneficiario no encontrado.' });
  const historyRes = await pool.query(
    `SELECT paid_at, due_date, amount, method, months, is_schedule_only, note
     FROM payments WHERE beneficiary_id = $1 ORDER BY paid_at DESC, id DESC`,
    [req.params.beneficiaryId]
  );
  res.json({
    fullName: `${benRes.rows[0].full_name} (beneficiario de ${benRes.rows[0].parent_name})`,
    history: historyRes.rows.map(h => ({
      ...h,
      amount: h.amount != null ? Number(h.amount) : null,
      methodLabel: METHOD_LABEL[h.method] || h.method || null,
    })),
  });
});

module.exports = router;
