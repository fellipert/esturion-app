const { pool } = require('../db');

// 0=domingo … 6=sábado (coincide con Date.getDay() de JS)
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Genera las clases concretas (tabla "classes") a partir de los horarios semanales activos
// y recurrentes, para una ventana de fechas. Es idempotente: usa ON CONFLICT para no duplicar,
// así que se puede llamar en cada consulta sin problema.
async function syncGeneratedClasses({ daysBack = 14, daysAhead = 90 } = {}) {
  const schedulesRes = await pool.query(
    `SELECT * FROM class_schedules WHERE active = true AND recurring = true`
  );
  const rangeStart = addDays(todayStr(), -daysBack);
  const rangeEnd = addDays(todayStr(), daysAhead);

  for (const sch of schedulesRes.rows) {
    let cursor = new Date(rangeStart + 'T00:00:00');
    while (cursor.getDay() !== sch.day_of_week) cursor.setDate(cursor.getDate() + 1);
    const endDate = new Date(rangeEnd + 'T00:00:00');

    while (cursor <= endDate) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const withinRange =
        (!sch.start_date || dateStr >= sch.start_date) &&
        (!sch.end_date || dateStr <= sch.end_date);
      if (withinRange) {
        // Si ya existe una clase manual (sin horario asociado) exactamente en esa fecha/hora,
        // la adopta en vez de crear una duplicada.
        const existing = await pool.query(
          `SELECT id FROM classes WHERE class_date = $1 AND class_time = $2 AND schedule_id IS NULL LIMIT 1`,
          [dateStr, sch.start_time]
        );
        if (existing.rows.length) {
          await pool.query(
            `UPDATE classes SET schedule_id = $1, schedule_type = $2 WHERE id = $3`,
            [sch.id, sch.schedule_type, existing.rows[0].id]
          );
        } else {
          await pool.query(
            `INSERT INTO classes (title, class_date, class_time, instructor, schedule_id, schedule_type, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (schedule_id, class_date) WHERE schedule_id IS NOT NULL DO NOTHING`,
            [sch.title, dateStr, sch.start_time, sch.instructor, sch.id, sch.schedule_type, sch.created_by]
          );
        }
      }
      cursor.setDate(cursor.getDate() + 7);
    }
  }
}

module.exports = { syncGeneratedClasses, DAY_NAMES, todayStr, addDays };
