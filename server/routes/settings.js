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

module.exports = router;
