#!/bin/bash
# Actualiza y reconstruye la app Esturión. Uso: ./deploy.sh
set -e
cd "$(dirname "$0")"
echo "→ Descargando cambios de GitHub..."
git pull
echo "→ Reconstruyendo y reiniciando contenedores..."
docker compose up -d --build
echo "✅ Listo. Revisa con: docker compose logs app --tail 20"
