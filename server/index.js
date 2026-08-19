require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const classRoutes = require('./routes/classes');
const paymentRoutes = require('./routes/payments');
const settingsRoutes = require('./routes/settings');
const messageRoutes = require('./routes/messages');
const beneficiaryRoutes = require('./routes/beneficiaries');
const scheduleRoutes = require('./routes/schedules');
const planRoutes = require('./routes/plans');
const { UPLOAD_DIR } = require('./middleware/upload');

const app = express();

// Detrás de Nginx (proxy inverso): sin esto, express-rate-limit revienta el proceso
// al ver la cabecera X-Forwarded-For que agrega Nginx.
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || true, credentials: true }));
app.use(express.json());

// Imágenes subidas (fotos de perfil, logo del club)
app.use('/uploads', express.static(UPLOAD_DIR));

// API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/beneficiaries', beneficiaryRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/plans', planRoutes);

// Frontend estático (build de public/)
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Manejador de errores (incluye errores de multer, ej. imagen muy grande)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Servidor Esturión escuchando en el puerto ${PORT}`);
});
