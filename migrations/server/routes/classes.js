const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Listar clases (todos los usuarios autenticados), con conteo de confirmados
// y si el usuario actual confirmó asistencia.
router.get('/', requireAuth, async (req, res) => {
  const classesRes = await pool.query('SELECT * FROM classes ORDER BY class_date ASC, class_time ASC');
  const attendanceRes = await pool.query(
    `SELECT class_id, COUNT(*) FILTER (WHERE confirmed) AS confirmed_count
     FROM attendance GROUP BY class_id`
  );
  const mineRes = await pool.query(
    `SELECT class_id FROM attendance WHERE user_id = $1 AND confirmed = true`,
    [req.user.id]
  );
  const countsByClass = Object.fromEntries(attendanceRes.rows.map(r => [r.class_id, Number(r.confirmed_count)]));
  const mineSet = new Set(mineRes.rows.map(r => r.class_id));

  const classes = classesRes.rows.map(c => ({
    id: c.id,
    title: c.title,
    date: c.class_date,
    time: c.class_time,
    instructor: c.instructor,
    confirmedCount: countsByClass[c.id] || 0,
    confirmedByMe: mineSet.has(c.id),
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

// Confirmar / retirar mi reserva a una clase (cualquier rol autenticado)
router.post('/:id/confirm', requireAuth, async (req, res) => {
  const classId = req.params.id;
  const existing = await pool.query(
    'SELECT * FROM attendance WHERE class_id = $1 AND user_id = $2',
    [classId, req.user.id]
  );
  let confirmed;
  if (existing.rows.length) {
    confirmed = !existing.rows[0].confirmed;
    await pool.query(
      'UPDATE attendance SET confirmed = $1, confirmed_at = now() WHERE class_id = $2 AND user_id = $3',
      [confirmed, classId, req.user.id]
    );
  } else {
    confirmed = true;
    await pool.query(
      'INSERT INTO attendance (class_id, user_id, confirmed) VALUES ($1,$2,true)',
      [classId, req.user.id]
    );
  }
  res.json({ confirmed });
});

// Ver el detalle de asistencia (reservas) de una clase — admin y super_admin
router.get('/:id/attendance', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.full_name, u.photo_url, a.confirmed_at, a.attended
     FROM attendance a JOIN users u ON u.id = a.user_id
     WHERE a.class_id = $1 AND a.confirmed = true
     ORDER BY u.full_name ASC`,
    [req.params.id]
  );
  res.json({ attendees: result.rows });
});

// Marcar si un cliente asistió realmente a una clase — admin y super_admin
router.put('/:id/attendance/:userId', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { attended } = req.body; // true | false
  const result = await pool.query(
    `UPDATE attendance SET attended = $1, attended_marked_at = now()
     WHERE class_id = $2 AND user_id = $3 RETURNING *`,
    [attended, req.params.id, req.params.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Registro de reserva no encontrado.' });
  res.json({ attendance: result.rows[0] });
});

// Estadísticas de asistencia de un cliente (admin ve cualquiera, cliente ve la suya con /me)
async function computeStats(userId) {
  const result = await pool.query(
    `SELECT confirmed, attended FROM attendance a
     JOIN classes c ON c.id = a.class_id
     WHERE a.user_id = $1 AND a.confirmed = true`,
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
