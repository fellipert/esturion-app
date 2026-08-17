const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Enviar un mensaje: individual (a un cliente), por clase (a quienes reservaron esa clase),
// o general (a todos los clientes) — admin y super_admin
router.post('/', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { scope, recipientUserId, recipientClassId, body } = req.body;
  if (!scope || !body || !body.trim()) return res.status(400).json({ error: 'Escribe el mensaje.' });
  if (!['individual', 'clase', 'general'].includes(scope)) return res.status(400).json({ error: 'Tipo de mensaje inválido.' });
  if (scope === 'individual' && !recipientUserId) return res.status(400).json({ error: 'Selecciona el cliente.' });
  if (scope === 'clase' && !recipientClassId) return res.status(400).json({ error: 'Selecciona la clase.' });

  const result = await pool.query(
    `INSERT INTO messages (sender_id, scope, recipient_user_id, recipient_class_id, body)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, scope, scope === 'individual' ? recipientUserId : null, scope === 'clase' ? recipientClassId : null, body.trim()]
  );
  res.status(201).json({ message: result.rows[0] });
});

// Historial de mensajes enviados — admin y super_admin
router.get('/sent', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const result = await pool.query(`
    SELECT m.*, u.full_name AS sender_name, ru.full_name AS recipient_name, c.title AS class_title
    FROM messages m
    LEFT JOIN users u ON u.id = m.sender_id
    LEFT JOIN users ru ON ru.id = m.recipient_user_id
    LEFT JOIN classes c ON c.id = m.recipient_class_id
    ORDER BY m.created_at DESC LIMIT 100
  `);
  res.json({ messages: result.rows });
});

// Mis mensajes recibidos (cualquier rol, pensado principalmente para clientes)
router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query(`
    SELECT m.*, u.full_name AS sender_name, c.title AS class_title
    FROM messages m
    LEFT JOIN users u ON u.id = m.sender_id
    LEFT JOIN classes c ON c.id = m.recipient_class_id
    WHERE m.scope = 'general'
       OR (m.scope = 'individual' AND m.recipient_user_id = $1)
       OR (m.scope = 'clase' AND m.recipient_class_id IN (
             SELECT class_id FROM attendance WHERE user_id = $1 AND confirmed = true
           ))
    ORDER BY m.created_at DESC LIMIT 50
  `, [req.user.id]);
  res.json({ messages: result.rows });
});

module.exports = router;
