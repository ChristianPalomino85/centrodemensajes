#!/bin/bash
cd /opt/flow-builder
git fetch origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
    echo "$(date): Nuevos cambios detectados, desplegando..."
    git pull origin main
    npm install
    npm run build
    systemctl restart flowbuilder
    echo "$(date): Deploy completado"
fi
