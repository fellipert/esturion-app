const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { syncGeneratedClasses, DAY_NAMES, todayStr, addDays } = require('../lib/scheduleSync');

const router = express.Router();

// Listar clases (ventana de -14 a +90 días), con conteo de confirmados y qué reservas
// propias (titular y/o beneficiarios) tiene el usuario actual. Genera automáticamente
// las clases que falten a partir de los horarios semanales activos.
router.get('/', requireAuth, async (req, res) => {
  await syncGeneratedClasses();
  const rangeStart = addDays(todayStr(), -14);
  const rangeEnd = addDays(todayStr(), 90);
  const classesRes = await pool.query(
    'SELECT * FROM classes WHERE class_date BETWEEN $1 AND $2 ORDER BY class_date ASC, class_time ASC',
    [rangeStart, rangeEnd]
  );
  const attendanceRes = await pool.query(
    `SELECT class_id, COUNT(*) FILTER (WHERE confirmed) AS confirmed_count
     FROM attendance GROUP BY class_id`
  );
  const mineRes = await pool.query(
    `SELECT class_id, beneficiary_id FROM attendance WHERE user_id = $1 AND confirmed = true`,
    [req.user.id]
  );
  const countsByClass = Object.fromEntries(attendanceRes.rows.map(r => [r.class_id, Number(r.confirmed_count)]));
  const mineByClass = {};
  mineRes.rows.forEach(r => {
    if (!mineByClass[r.class_id]) mineByClass[r.class_id] = { self: false, beneficiaryIds: [] };
    if (r.beneficiary_id) mineByClass[r.class_id].beneficiaryIds.push(r.beneficiary_id);
    else mineByClass[r.class_id].self = true;
  });

  const classes = classesRes.rows.map(c => ({
    id: c.id,
    title: c.title,
    date: c.class_date,
    time: c.class_time,
    instructor: c.instructor,
    scheduleId: c.schedule_id,
    scheduleType: c.schedule_type,
    status: c.status,
    confirmedCount: countsByClass[c.id] || 0,
    confirmedByMe: !!(mineByClass[c.id] && mineByClass[c.id].self),
    myConfirmedBeneficiaryIds: (mineByClass[c.id] && mineByClass[c.id].beneficiaryIds) || [],
  }));
  res.json({ classes });
});

// Vista semanal para el calendario: una semana completa (domingo a sábado), con navegación
// por "offset" (0 = semana actual, 1 = siguiente, -1 = anterior, etc.)
router.get('/week', requireAuth, async (req, res) => {
  await syncGeneratedClasses();
  const offset = parseInt(req.query.offset || '0', 10) || 0;
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() + offset * 7);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = addDays(startStr, 6);

  const classesRes = await pool.query(
    `SELECT * FROM classes WHERE class_date BETWEEN $1 AND $2 AND status != 'cancelada'
     ORDER BY class_date ASC, class_time ASC`,
    [startStr, endStr]
  );
  const ids = classesRes.rows.map(c => c.id);
  const attendanceRes = ids.length
    ? await pool.query(
        `SELECT class_id, COUNT(*) FILTER (WHERE confirmed) AS confirmed_count FROM attendance
         WHERE class_id = ANY($1::int[]) GROUP BY class_id`,
        [ids]
      )
    : { rows: [] };
  const mineRes = ids.length
    ? await pool.query(
        `SELECT class_id, beneficiary_id FROM attendance
         WHERE user_id = $1 AND confirmed = true AND class_id = ANY($2::int[])`,
        [req.user.id, ids]
      )
    : { rows: [] };
  const countsByClass = Object.fromEntries(attendanceRes.rows.map(r => [r.class_id, Number(r.confirmed_count)]));
  const mineByClass = {};
  mineRes.rows.forEach(r => {
    if (!mineByClass[r.class_id]) mineByClass[r.class_id] = { self: false, beneficiaryIds: [] };
    if (r.beneficiary_id) mineByClass[r.class_id].beneficiaryIds.push(r.beneficiary_id);
    else mineByClass[r.class_id].self = true;
  });

  const days = [];
  for (let i = 0; i < 7; i++) {
    const dateStr = addDays(startStr, i);
    const dayClasses = classesRes.rows
      .filter(c => c.class_date === dateStr)
      .map(c => ({
        id: c.id,
        title: c.title,
        time: c.class_time,
        instructor: c.instructor,
        scheduleId: c.schedule_id,
        scheduleType: c.schedule_type,
        status: c.status,
        confirmedCount: countsByClass[c.id] || 0,
        confirmedByMe: !!(mineByClass[c.id] && mineByClass[c.id].self),
        myConfirmedBeneficiaryIds: (mineByClass[c.id] && mineByClass[c.id].beneficiaryIds) || [],
      }));
    days.push({ date: dateStr, dayOfWeek: i, dayName: DAY_NAMES[i], classes: dayClasses });
  }
  res.json({ weekStart: startStr, weekEnd: endStr, offset, days });
});

// Crear clase puntual/extraordinaria — admin y super_admin
router.post('/', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { title, date, time, instructor } = req.body;
  if (!title || !date || !time) return res.status(400).json({ error: 'Título, fecha y hora son obligatorios.' });
  const result = await pool.query(
    `INSERT INTO classes (title, class_date, class_time, instructor, schedule_type, created_by)
     VALUES ($1,$2,$3,$4,'extraordinaria',$5) RETURNING *`,
    [title, date, time, instructor || null, req.user.id]
  );
  res.status(201).json({ class: result.rows[0] });
});

// Editar clase — admin y super_admin
router.put('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { title, date, time, instructor } = req.body;
  const result = await pool.query(
    `UPDATE classes SET title = COALESCE($1,title), class_date = COALESCE($2,class_date),
     class_time = COALESCE($3,class_time), instructor = $4 WHERE id = $5 RETURNING *`,
    [title || null, date || null, time || null, instructor || null, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Clase no encontrada.' });
  res.json({ class: result.rows[0] });
});

// Cancelar una clase específica (queda visible marcada como CANCELADA) — admin y super_admin
router.put('/:id/cancel', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const result = await pool.query(`UPDATE classes SET status = 'cancelada' WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Clase no encontrada.' });
  res.json({ class: result.rows[0] });
});

// Reactivar una clase cancelada — admin y super_admin
router.put('/:id/restore', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const result = await pool.query(`UPDATE classes SET status = 'programada' WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Clase no encontrada.' });
  res.json({ class: result.rows[0] });
});

// Eliminar clase por completo — admin y super_admin
router.delete('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  await pool.query('DELETE FROM classes WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Confirmar / retirar mi reserva a una clase, para mí (beneficiaryId ausente) o para un
// beneficiario específico (beneficiaryId presente). Verifica que el beneficiario sea propio.
// Créditos: 1 crédito = 1 clase. Solo aplica a role='cliente' — el pool de créditos es
// compartido entre el titular y sus beneficiarios (una sola cuenta, un solo saldo).
async function hasAvailableCredits(userId, beneficiaryId) {
  if (beneficiaryId) {
    const b = await pool.query('SELECT credits_assigned, credits_used FROM beneficiaries WHERE id = $1', [beneficiaryId]);
    if (!b.rows.length) return true;
    return (b.rows[0].credits_assigned - b.rows[0].credits_used) > 0;
  }
  const c = await pool.query('SELECT credits_assigned, credits_used FROM clients WHERE user_id = $1', [userId]);
  if (!c.rows.length) return true;
  return (c.rows[0].credits_assigned - c.rows[0].credits_used) > 0;
}
async function adjustCredits(userId, beneficiaryId, delta) {
  if (beneficiaryId) {
    await pool.query(
      'UPDATE beneficiaries SET credits_used = GREATEST(0, LEAST(credits_assigned, credits_used + $1)) WHERE id = $2',
      [delta, beneficiaryId]
    );
    return;
  }
  await pool.query(
    'UPDATE clients SET credits_used = GREATEST(0, LEAST(credits_assigned, credits_used + $1)) WHERE user_id = $2',
    [delta, userId]
  );
}
// La mensualidad vencida bloquea nuevas reservas, aunque todavía tenga créditos sin usar
// de un ciclo anterior. Cada beneficiario tiene su propio vencimiento; el titular, el suyo.
async function isPaymentOverdue(userId, beneficiaryId) {
  const result = await pool.query(
    beneficiaryId
      ? 'SELECT due_date FROM payments WHERE beneficiary_id = $1 ORDER BY created_at DESC LIMIT 1'
      : 'SELECT due_date FROM payments WHERE user_id = $1 AND beneficiary_id IS NULL ORDER BY created_at DESC LIMIT 1',
    [beneficiaryId || userId]
  );
  if (!result.rows.length) return false; // sin ningún pago registrado aún: no se bloquea aquí
  const dueDate = result.rows[0].due_date;
  const today = new Date().toISOString().slice(0, 10);
  return new Date(dueDate) < new Date(today);
}

router.post('/:id/confirm', requireAuth, async (req, res) => {
  const classId = req.params.id;
  const beneficiaryId = req.body.beneficiaryId || null;

  if (beneficiaryId) {
    const owns = await pool.query(
      'SELECT id FROM beneficiaries WHERE id = $1 AND client_user_id = $2',
      [beneficiaryId, req.user.id]
    );
    if (!owns.rows.length) return res.status(403).json({ error: 'Ese beneficiario no pertenece a tu cuenta.' });
  }

  const existing = await pool.query(
    'SELECT * FROM attendance WHERE class_id = $1 AND user_id = $2 AND COALESCE(beneficiary_id,0) = COALESCE($3,0)',
    [classId, req.user.id, beneficiaryId]
  );
  let confirmed;
  if (existing.rows.length) {
    confirmed = !existing.rows[0].confirmed;
    // Cancelar (pasar de confirmado a no confirmado) — no se permite a menos de 15 minutos de la clase
    if (!confirmed && req.user.role === 'cliente') {
      const clsRes = await pool.query('SELECT class_date, class_time FROM classes WHERE id = $1', [classId]);
      if (clsRes.rows.length) {
        const classDateTime = new Date(`${clsRes.rows[0].class_date}T${clsRes.rows[0].class_time}`);
        const minutesLeft = (classDateTime.getTime() - Date.now()) / 60000;
        if (minutesLeft < 15) {
          return res.status(403).json({ error: 'No puedes eliminar la reserva a menos de 15 minutos de que empiece la clase.' });
        }
      }
    }
    if (req.user.role === 'cliente') {
      if (confirmed) {
        if (await isPaymentOverdue(req.user.id, beneficiaryId)) {
          return res.status(403).json({ error: 'La mensualidad está vencida. Contacta a la administración para poder reservar clases.' });
        }
        if (!(await hasAvailableCredits(req.user.id, beneficiaryId))) {
          return res.status(403).json({ error: 'No hay créditos disponibles para reservar esta clase.' });
        }
        await adjustCredits(req.user.id, beneficiaryId, 1);
      } else {
        await adjustCredits(req.user.id, beneficiaryId, -1);
      }
    }
    await pool.query(
      'UPDATE attendance SET confirmed = $1, confirmed_at = now() WHERE id = $2',
      [confirmed, existing.rows[0].id]
    );
  } else {
    if (req.user.role === 'cliente') {
      if (await isPaymentOverdue(req.user.id, beneficiaryId)) {
        return res.status(403).json({ error: 'La mensualidad está vencida. Contacta a la administración para poder reservar clases.' });
      }
      if (!(await hasAvailableCredits(req.user.id, beneficiaryId))) {
        return res.status(403).json({ error: 'No hay créditos disponibles para reservar esta clase.' });
      }
      await adjustCredits(req.user.id, beneficiaryId, 1);
    }
    confirmed = true;
    await pool.query(
      'INSERT INTO attendance (class_id, user_id, beneficiary_id, confirmed) VALUES ($1,$2,$3,true)',
      [classId, req.user.id, beneficiaryId]
    );
  }
  res.json({ confirmed, beneficiaryId });
});

// Confirmar de una vez para el titular y todos sus beneficiarios (cada uno con su propio
// vencimiento y créditos — se salta a quien esté vencido o sin crédito, sin bloquear al resto)
router.post('/:id/confirm-all', requireAuth, async (req, res) => {
  const classId = req.params.id;
  const beneficiaries = await pool.query(
    'SELECT id FROM beneficiaries WHERE client_user_id = $1', [req.user.id]
  );
  const people = [null, ...beneficiaries.rows.map(b => b.id)];
  let confirmedCount = 0, skippedForCredits = 0, skippedForOverdue = 0;
  for (const beneficiaryId of people) {
    const existing = await pool.query(
      'SELECT id, confirmed FROM attendance WHERE class_id = $1 AND user_id = $2 AND COALESCE(beneficiary_id,0) = COALESCE($3,0)',
      [classId, req.user.id, beneficiaryId]
    );
    const alreadyConfirmed = existing.rows.length && existing.rows[0].confirmed;
    if (alreadyConfirmed) { confirmedCount++; continue; }
    if (req.user.role === 'cliente' && await isPaymentOverdue(req.user.id, beneficiaryId)) {
      skippedForOverdue++;
      continue;
    }
    if (req.user.role === 'cliente' && !(await hasAvailableCredits(req.user.id, beneficiaryId))) {
      skippedForCredits++;
      continue;
    }
    if (req.user.role === 'cliente') await adjustCredits(req.user.id, beneficiaryId, 1);
    if (existing.rows.length) {
      await pool.query('UPDATE attendance SET confirmed = true, confirmed_at = now() WHERE id = $1', [existing.rows[0].id]);
    } else {
      await pool.query(
        'INSERT INTO attendance (class_id, user_id, beneficiary_id, confirmed) VALUES ($1,$2,$3,true)',
        [classId, req.user.id, beneficiaryId]
      );
    }
    confirmedCount++;
  }
  res.json({ ok: true, count: confirmedCount, skippedForCredits, skippedForOverdue });
});

// Ver el detalle de asistencia (reservas) de una clase — admin y super_admin.
// Incluye si la reserva es del titular o de un beneficiario suyo.
router.get('/:id/attendance', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const result = await pool.query(
    `SELECT a.id AS attendance_id, u.id AS user_id, u.full_name AS account_name, u.photo_url,
            b.id AS beneficiary_id, b.full_name AS beneficiary_name,
            a.confirmed_at, a.attended
     FROM attendance a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN beneficiaries b ON b.id = a.beneficiary_id
     WHERE a.class_id = $1 AND a.confirmed = true
     ORDER BY u.full_name ASC, b.full_name ASC NULLS FIRST`,
    [req.params.id]
  );
  res.json({ attendees: result.rows });
});

// Marcar si alguien (titular o beneficiario) asistió realmente — admin y super_admin.
// Se identifica por el id del propio registro de asistencia (attendance.id).
router.put('/:classId/attendance/:attendanceId', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { attended } = req.body; // true | false
  const result = await pool.query(
    `UPDATE attendance SET attended = $1, attended_marked_at = now()
     WHERE id = $2 AND class_id = $3 RETURNING *`,
    [attended, req.params.attendanceId, req.params.classId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Registro de reserva no encontrado.' });
  res.json({ attendance: result.rows[0] });
});

// Estadísticas de asistencia (agregadas: titular + sus beneficiarios)
async function computeStats(userId) {
  const result = await pool.query(
    `SELECT confirmed, attended FROM attendance WHERE user_id = $1 AND confirmed = true`,
    [userId]
  );
  const reservadas = result.rows.length;
  const marcadas = result.rows.filter(r => r.attended !== null);
  const asistencias = result.rows.filter(r => r.attended === true).length;
  const inasistencias = result.rows.filter(r => r.attended === false).length;
  const porcentaje = marcadas.length ? Math.round((asistencias / marcadas.length) * 1000) / 10 : null;
  return { reservadas, asistencias, inasistencias, porcentaje };
}

router.get('/attendance-stats/me', requireAuth, async (req, res) => {
  res.json(await computeStats(req.user.id));
});

router.get('/attendance-stats/:userId', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  res.json(await computeStats(req.params.userId));
});

module.exports = router;
