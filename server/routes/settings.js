const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.get('/logo', async (req, res) => {
  const result = await pool.query("SELECT value FROM club_settings WHERE key = 'logo_url'");
  res.json({ logoUrl: result.rows[0]?.value || null });
});

// Cambiar el logo del club — solo super_admin (es parte de la "estructura" del club)
router.post('/logo', requireAuth, requireRole('super_admin'), upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
  const url = `/uploads/${req.file.filename}`;
  await pool.query(
    `INSERT INTO club_settings (key, value) VALUES ('logo_url', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1`,
    [url]
  );
  res.json({ logoUrl: url });
});

// Ver el código de invitación actual — admin y super_admin
router.get('/invite-code', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const result = await pool.query("SELECT value FROM club_settings WHERE key = 'invite_code'");
  res.json({ inviteCode: result.rows[0]?.value || null });
});

// Cambiar/regenerar el código de invitación — admin y super_admin
router.post('/invite-code', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  let { code } = req.body;
  if (!code || !code.trim()) {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
  }
  code = code.trim();
  await pool.query(
    `INSERT INTO club_settings (key, value) VALUES ('invite_code', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1`,
    [code]
  );
  res.json({ inviteCode: code });
});

module.exports = router;
