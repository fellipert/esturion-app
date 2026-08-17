# Despliegue en tu VPS de Hostinger (con Docker)

La app corre como un servicio Docker independiente llamado **esturion** (dos contenedores: `esturion-app` y `esturion-db`), aislado de lo demás que tengas en el VPS. Nginx queda en el host haciendo de puerta de entrada hacia el contenedor.

## 1. Instala Docker (una sola vez)

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
docker --version
docker compose version
```

Instala también Nginx y el firewall si aún no lo hiciste:
```bash
apt install -y nginx ufw
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

## 2. Sube el proyecto al VPS

Desde tu Mac, dentro de la carpeta que contiene `esturion-app`:
```bash
rsync -avz --exclude 'node_modules' --exclude '.env' --exclude 'uploads' \
  ./esturion-app/ root@TU_IP_REAL:/var/www/esturion/
```

## 3. Configura las variables de entorno

En el VPS:
```bash
cd /var/www/esturion
cp .env.example .env
nano .env
```
Completa `DB_PASSWORD`, `JWT_SECRET` y `CLIENT_ORIGIN` (la variable `DATABASE_URL` no se usa en este modo, ignórala).

## 4. Levanta el servicio Docker "esturion"

```bash
cd /var/www/esturion
docker compose up -d --build
```

Esto construye la imagen de la app, crea el contenedor de PostgreSQL (`esturion-db`) y carga automáticamente `migrations/schema.sql` la primera vez (crea las tablas y las 3 cuentas iniciales). Verifica que ambos contenedores estén corriendo:

```bash
docker compose ps
docker compose logs -f app
```

Deberías ver `Servidor Esturión escuchando en el puerto 4000`. Sal de los logs con `Ctrl + C` (no detiene el contenedor).

Prueba localmente:
```bash
curl http://127.0.0.1:4000/api/settings/logo
```

## 5. Configura Nginx como proxy inverso

```bash
cp nginx.esturion.conf /etc/nginx/sites-available/esturion
nano /etc/nginx/sites-available/esturion   # reemplaza tu-dominio.com
ln -sf /etc/nginx/sites-available/esturion /etc/nginx/sites-enabled/esturion
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## 6. Activa HTTPS

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d tu-dominio.com -d www.tu-dominio.com
```

## Mantenimiento del servicio Docker "esturion"

- **Ver logs:** `docker compose logs -f app` (o `-f db` para la base de datos)
- **Reiniciar tras subir cambios de código:** 
  ```bash
  cd /var/www/esturion
  docker compose up -d --build
  ```
  (reconstruye solo lo que cambió y reinicia el contenedor `app`, sin tocar la base de datos)
- **Entrar a la base de datos:** `docker exec -it esturion-db psql -U esturion -d esturion_db`
- **Respaldar la base de datos:** `docker exec esturion-db pg_dump -U esturion esturion_db > backup_$(date +%F).sql`
- **Restaurar un respaldo:** `cat backup.sql | docker exec -i esturion-db psql -U esturion -d esturion_db`
- **Detener todo el servicio:** `docker compose down` (los datos persisten en los volúmenes `esturion_db_data` y `esturion_uploads` aunque detengas los contenedores)
- **Borrar todo desde cero (incluye datos):** `docker compose down -v`

## Notas de seguridad para producción

- Cambia la contraseña del admin apenas entres por primera vez.
- El `JWT_SECRET` debe ser único y no compartirse.
- Considera limitar los registros abiertos (`/api/auth/register`) a una lista de invitación.
- El puerto 4000 solo escucha en `127.0.0.1` (dentro del propio VPS) — no es accesible desde internet directamente, solo a través de Nginx.

---

## Alternativa: despliegue sin Docker (Node + PostgreSQL directo en el VPS)

Si prefieres no usar Docker, puedes instalar Node.js, PostgreSQL y PM2 directamente en el VPS y correr la app como proceso nativo. Los pasos son los mismos que ya hicimos juntos: instalar dependencias del sistema, crear la base de datos con `psql`, `.env` con `DATABASE_URL`, `npm install --omit=dev`, cargar `migrations/schema.sql`, y `pm2 start ecosystem.config.js`. Dime si prefieres retomar por ahí en vez de Docker.
