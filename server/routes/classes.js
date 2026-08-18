const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Listar clases (todos los usuarios autenticados), con conteo de confirmados
// y qué reservas propias (titular y/o beneficiarios) tiene el usuario actual.
router.get('/', requireAuth, async (req, res) => {
  const classesRes = await pool.query('SELECT * FROM classes ORDER BY class_date ASC, class_time ASC');
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
    confirmedCount: countsByClass[c.id] || 0,
    confirmedByMe: !!(mineByClass[c.id] && mineByClass[c.id].self),
    myConfirmedBeneficiaryIds: (mineByClass[c.id] && mineByClass[c.id].beneficiaryIds) || [],
  }));
  res.json({ classes });
});

// Crear clase — solo super_admin (gestiona la estructura del club)
router.post('/', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { title, date, time, instructor } = req.body;
  if (!title || !date || !time) return res.status(400).json({ error: 'Título, fecha y hora son obligatorios.' });
  const result = await pool.query(
    `INSERT INTO classes (title, class_date, class_time, instructor, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [title, date, time, instructor || null, req.user.id]
  );
  res.status(201).json({ class: result.rows[0] });
});

// Editar clase — solo super_admin
router.put('/:id', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { title, date, time, instructor } = req.body;
  const result = await pool.query(
    `UPDATE classes SET title = COALESCE($1,title), class_date = COALESCE($2,class_date),
     class_time = COALESCE($3,class_time), instructor = $4 WHERE id = $5 RETURNING *`,
    [title || null, date || null, time || null, instructor || null, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Clase no encontrada.' });
  res.json({ class: result.rows[0] });
});

// Eliminar clase — solo super_admin
router.delete('/:id', requireAuth, requireRole('super_admin'), async (req, res) => {
  await pool.query('DELETE FROM classes WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Confirmar / retirar mi reserva a una clase, para mí (beneficiaryId ausente) o para un
// beneficiario específico (beneficiaryId presente). Verifica que el beneficiario sea propio.
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
    await pool.query(
      'UPDATE attendance SET confirmed = $1, confirmed_at = now() WHERE id = $2',
      [confirmed, existing.rows[0].id]
    );
  } else {
    confirmed = true;
    await pool.query(
      'INSERT INTO attendance (class_id, user_id, beneficiary_id, confirmed) VALUES ($1,$2,$3,true)',
      [classId, req.user.id, beneficiaryId]
    );
  }
  res.json({ confirmed, beneficiaryId });
});

// Confirmar de una vez para el titular y todos sus beneficiarios
router.post('/:id/confirm-all', requireAuth, async (req, res) => {
  const classId = req.params.id;
  const beneficiaries = await pool.query(
    'SELECT id FROM beneficiaries WHERE client_user_id = $1', [req.user.id]
  );
  const people = [null, ...beneficiaries.rows.map(b => b.id)];
  for (const beneficiaryId of people) {
    const existing = await pool.query(
      'SELECT id FROM attendance WHERE class_id = $1 AND user_id = $2 AND COALESCE(beneficiary_id,0) = COALESCE($3,0)',
      [classId, req.user.id, beneficiaryId]
    );
    if (existing.rows.length) {
      await pool.query('UPDATE attendance SET confirmed = true, confirmed_at = now() WHERE id = $1', [existing.rows[0].id]);
    } else {
      await pool.query(
        'INSERT INTO attendance (class_id, user_id, beneficiary_id, confirmed) VALUES ($1,$2,$3,true)',
        [classId, req.user.id, beneficiaryId]
      );
    }
  }
  res.json({ ok: true, count: people.length });
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
