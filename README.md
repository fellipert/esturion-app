# Esturión — App del club de natación

Aplicación web para el club de natación Esturión: registro de socios, perfiles con foto, clases con confirmación de asistencia, registro de asistencia, control de pagos y alertas de vencimiento de mensualidad.

## Stack
- Backend: Node.js + Express + PostgreSQL
- Autenticación: JWT + bcrypt
- Frontend: HTML/CSS/JS sin build step, servido como estático por el mismo servidor Express
- Imágenes: subidas locales con multer (fotos de perfil y logo del club)

## Desarrollo local

```bash
npm install
cp .env.example .env   # y completa DATABASE_URL / JWT_SECRET
# crea la base de datos localmente y carga migrations/schema.sql
npm run dev
```

Abre `http://localhost:4000`. Cuentas de prueba (login por correo):
- Súper administrador: `djandre0988@gmail.com` / `1234`
- Administrador: `maria_camigo4@hotmail.com` / `0000`
- Administrador: `susigonzalezbetancur.25@gmail.com` / `0000`

## Roles

- **super_admin**: control total — crea/edita/elimina clases, gestiona cuentas de usuario (crear, cambiar rol, eliminar) y el logo del club.
- **admin**: ve toda la información (clientes, asistencia, cartera) y registra pagos, pero no puede crear/editar/eliminar clases ni gestionar cuentas.
- **cliente**: visualiza las clases, confirma su asistencia y ve su propia mensualidad.

## Producción — servicio Docker "esturion"

La forma recomendada de desplegar es como servicio Docker independiente (contenedores `esturion-app` + `esturion-db`):

```bash
cp .env.example .env   # completa DB_PASSWORD, JWT_SECRET, CLIENT_ORIGIN
docker compose up -d --build
```

Ver `DEPLOY.md` para la guía completa en un VPS de Hostinger (Docker + Nginx + Let's Encrypt), y la alternativa sin Docker si la prefieres.

## Estructura

```
Dockerfile, docker-compose.yml   servicio Docker "esturion"
server/
  index.js          punto de entrada Express
  db.js             pool de PostgreSQL
  middleware/        auth (JWT), subida de imágenes
  routes/            auth, users, classes, payments, messages, settings
public/
  index.html, app.js, styles.css   frontend
migrations/
  schema.sql         esquema de base de datos (se carga automático en Docker la primera vez)
```
