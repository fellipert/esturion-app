const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { syncGeneratedClasses, DAY_NAMES } = require('../lib/scheduleSync');

const router = express.Router();

function publicSchedule(row) {
  return {
    id: row.id,
    dayOfWeek: row.day_of_week,
    dayName: DAY_NAMES[row.day_of_week],
    startTime: row.start_time,
    endTime: row.end_time,
    title: row.title,
    instructor: row.instructor,
    scheduleType: row.schedule_type,
    recurring: row.recurring,
    active: row.active,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes,
  };
}

// Listar horarios: clientes solo ven los activos, admin/super_admin ven todos (para gestionar)
router.get('/', requireAuth, async (req, res) => {
  const isStaff = ['admin', 'super_admin'].includes(req.user.role);
  const result = await pool.query(
    isStaff
      ? 'SELECT * FROM class_schedules ORDER BY day_of_week ASC, start_time ASC'
      : 'SELECT * FROM class_schedules WHERE active = true ORDER BY day_of_week ASC, start_time ASC'
  );
  res.json({ schedules: result.rows.map(publicSchedule) });
});

// Crear un horario semanal recurrente — admin y super_admin
router.post('/', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { dayOfWeek, startTime, endTime, title, instructor, scheduleType, recurring, active, startDate, endDate, notes } = req.body;
  if (dayOfWeek === undefined || dayOfWeek === null || !startTime) {
    return res.status(400).json({ error: 'Día de la semana y hora son obligatorios.' });
  }
  const result = await pool.query(
    `INSERT INTO class_schedules (day_of_week, start_time, end_time, title, instructor, schedule_type, recurring, active, start_date, end_date, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [dayOfWeek, startTime, endTime || null, title || 'Clase de natación', instructor || null,
     scheduleType || 'regular', recurring !== false, active !== false, startDate || null, endDate || null, notes || null, req.user.id]
  );
  if (result.rows[0].active) await syncGeneratedClasses();
  res.status(201).json({ schedule: publicSchedule(result.rows[0]) });
});

// Editar un horario — admin y super_admin
router.put('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { dayOfWeek, startTime, endTime, title, instructor, scheduleType, recurring, startDate, endDate, notes } = req.body;
  const result = await pool.query(
    `UPDATE class_schedules SET
       day_of_week = COALESCE($1, day_of_week),
       start_time = COALESCE($2, start_time),
       end_time = $3,
       title = COALESCE($4, title),
       instructor = $5,
       schedule_type = COALESCE($6, schedule_type),
       recurring = COALESCE($7, recurring),
       start_date = $8,
       end_date = $9,
       notes = $10,
       updated_at = now()
     WHERE id = $11 RETURNING *`,
    [dayOfWeek ?? null, startTime || null, endTime || null, title || null, instructor || null,
     scheduleType || null, typeof recurring === 'boolean' ? recurring : null, startDate || null, endDate || null, notes || null, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Horario no encontrado.' });
  if (result.rows[0].active) await syncGeneratedClasses();
  res.json({ schedule: publicSchedule(result.rows[0]) });
});

// Activar/desactivar un horario — admin y super_admin. Al desactivar, cancela las clases
// futuras ya generadas desde ese horario; al reactivar, las reprograma y regenera.
router.put('/:id/toggle', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const current = await pool.query('SELECT * FROM class_schedules WHERE id = $1', [req.params.id]);
  if (!current.rows.length) return res.status(404).json({ error: 'Horario no encontrado.' });
  const newActive = !current.rows[0].active;
  const result = await pool.query(
    'UPDATE class_schedules SET active = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [newActive, req.params.id]
  );
  if (newActive) {
    await syncGeneratedClasses();
    await pool.query(
      `UPDATE classes SET status = 'programada' WHERE schedule_id = $1 AND status = 'cancelada' AND class_date >= CURRENT_DATE`,
      [req.params.id]
    );
  } else {
    await pool.query(
      `UPDATE classes SET status = 'cancelada' WHERE schedule_id = $1 AND status = 'programada' AND class_date >= CURRENT_DATE`,
      [req.params.id]
    );
  }
  res.json({ schedule: publicSchedule(result.rows[0]) });
});

// Eliminar un horario — admin y super_admin (las clases ya generadas quedan, solo pierden el vínculo)
router.delete('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  await pool.query('DELETE FROM class_schedules WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Mi horario habitual (cliente)
router.get('/preference/me', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT p.preferred_schedule_id, s.day_of_week, s.start_time, s.title, s.active
     FROM user_class_preferences p JOIN class_schedules s ON s.id = p.preferred_schedule_id
     WHERE p.user_id = $1`,
    [req.user.id]
  );
  if (!result.rows.length) return res.json({ preference: null });
  const r = result.rows[0];
  res.json({
    preference: {
      scheduleId: r.preferred_schedule_id,
      dayOfWeek: r.day_of_week,
      dayName: DAY_NAMES[r.day_of_week],
      startTime: r.start_time,
      title: r.title,
      active: r.active,
    },
  });
});

// Fijar mi horario habitual (cliente) — solo uno activo a la vez
router.put('/preference/me', requireAuth, async (req, res) => {
  const { scheduleId } = req.body;
  if (!scheduleId) return res.status(400).json({ error: 'Selecciona un horario.' });
  await pool.query(
    `INSERT INTO user_class_preferences (user_id, preferred_schedule_id, updated_at)
     VALUES ($1,$2,now())
     ON CONFLICT (user_id) DO UPDATE SET preferred_schedule_id = $2, updated_at = now()`,
    [req.user.id, scheduleId]
  );
  res.json({ ok: true });
});

module.exports = router;
