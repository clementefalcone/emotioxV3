#!/bin/bash

# Script para desplegar SOLO el backend a cPanel
# Enfoque: Hacer que el backend funcione primero antes de los frontends

set -euo pipefail

# Colores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuración
SSH_HOST="cpanel-emotio"
REMOTE_BASE_DIR="~/emotioxv3"
REMOTE_BACKEND_DIR="$REMOTE_BASE_DIR/backend"
LOCAL_PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_BACKEND_DIR="$LOCAL_PROJECT_DIR/backend"

echo -e "${BLUE}🚀 Despliegue del Backend a cPanel${NC}"
echo "=================================================="
echo ""

# Verificar que estamos en el directorio correcto
if [ ! -d "$LOCAL_BACKEND_DIR" ]; then
    echo -e "${RED}❌ Error: No se encontró el directorio backend${NC}"
    exit 1
fi

# Verificar conexión SSH
echo -e "${BLUE}🔍 Verificando conexión SSH...${NC}"
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$SSH_HOST" "echo 'OK'" &>/dev/null; then
    echo -e "${RED}❌ Error: No se puede conectar a $SSH_HOST${NC}"
    echo "   Ejecuta: ./scripts/setup-ssh-agent.sh"
    exit 1
fi
echo -e "${GREEN}✅ Conexión SSH establecida${NC}"
echo ""

# Función para ejecutar comandos remotos
run_remote() {
    ssh "$SSH_HOST" "$@"
}

# Función para transferir archivos
transfer_files() {
    rsync -avz --exclude 'node_modules' --exclude 'dist' --exclude '.env' \
        --exclude 'python-saliency/venv' --exclude 'python-saliency/logs' \
        --exclude 'python-saliency/pid.txt' --exclude 'python-saliency/__pycache__' \
        --exclude 'python-saliency/.pytest_cache' --exclude 'python-saliency/tests/__pycache__' \
        --exclude 'models/*.onnx' --exclude 'models/*.pth' \
        "$1" "$SSH_HOST:$2"
}

# Paso 1: Crear estructura de directorios
echo -e "${BLUE}📁 Creando estructura de directorios...${NC}"
run_remote "mkdir -p $REMOTE_BACKEND_DIR"
echo -e "${GREEN}✅ Estructura creada${NC}"
echo ""

# Paso 2: Transferir código fuente (sin node_modules, dist, .env)
echo -e "${BLUE}📦 Transferiendo código fuente...${NC}"
transfer_files "$LOCAL_BACKEND_DIR/" "$REMOTE_BACKEND_DIR/"
echo -e "${GREEN}✅ Código transferido${NC}"
echo ""

# Paso 3: Verificar si existe .env en servidor
echo -e "${BLUE}🔍 Verificando configuración...${NC}"
ENV_EXISTS=$(run_remote "test -f $REMOTE_BACKEND_DIR/.env && echo 'yes' || echo 'no'")

if [ "$ENV_EXISTS" = "no" ]; then
    echo -e "${YELLOW}⚠️  No se encontró .env en el servidor${NC}"
    echo ""
    echo "Creando archivo .env de ejemplo..."
    run_remote "cat > $REMOTE_BACKEND_DIR/.env.example << 'ENVEOF'
# Base de Datos
DB_HOST=tu-db-host.neon.tech
DB_PORT=5432
DB_NAME=emotioxv3
DB_USER=usuario
DB_PASSWORD=password
DB_SSL=true

# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=tu-key
AWS_SECRET_ACCESS_KEY=tu-secret
S3_BUCKET_NAME=emotioxv3-media-xxxxx

# Cognito
COGNITO_USER_POOL_ID=us-east-1_xxxxx
COGNITO_CLIENT_ID=xxxxx

# CORS
CORS_ORIGIN=https://emotio.cx
RESEARCH_FRONTEND_URL=https://emotio.cx/research
PARTICIPANT_FRONTEND_URL=https://emotio.cx/participant

# Server
PORT=3000
NODE_ENV=production
ENVEOF
"
    echo -e "${YELLOW}⚠️  IMPORTANTE: Configura las variables en $REMOTE_BACKEND_DIR/.env${NC}"
    echo "   Puedes copiar .env.example a .env y editarlo:"
    echo "   ssh $SSH_HOST"
    echo "   cd $REMOTE_BACKEND_DIR"
    echo "   cp .env.example .env"
    echo "   nano .env"
    echo ""
    read -p "¿Deseas continuar con la instalación? (s/n): " CONTINUE
    if [ "$CONTINUE" != "s" ] && [ "$CONTINUE" != "S" ]; then
        echo "Despliegue cancelado. Configura .env primero."
        exit 0
    fi
else
    echo -e "${GREEN}✅ Archivo .env encontrado${NC}"
fi
echo ""

# Paso 4: Instalar dependencias
echo -e "${BLUE}📦 Instalando dependencias...${NC}"
run_remote "cd $REMOTE_BACKEND_DIR && npm install --production=false"
echo -e "${GREEN}✅ Dependencias instaladas${NC}"
echo ""

# Paso 5: Compilar TypeScript
echo -e "${BLUE}🔨 Compilando TypeScript...${NC}"
if ! run_remote "cd $REMOTE_BACKEND_DIR && npm run build"; then
    echo -e "${RED}❌ npm run build falló en $SSH_HOST:$REMOTE_BACKEND_DIR; dist/ conserva la compilación anterior. Sin error de tsc arriba = proceso terminado por el servidor: reintenta el deploy.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Compilación completada${NC}"
echo ""

# Paso 6: Verificar que server-cpanel.js existe
echo -e "${BLUE}🔍 Verificando archivos de despliegue...${NC}"
if ! run_remote "test -f $REMOTE_BACKEND_DIR/server-cpanel.js" 2>/dev/null; then
    echo -e "${YELLOW}⚠️  server-cpanel.js no encontrado, copiando...${NC}"
    scp "$LOCAL_BACKEND_DIR/server-cpanel.js" "$SSH_HOST:$REMOTE_BACKEND_DIR/"
fi

if ! run_remote "test -f $REMOTE_BACKEND_DIR/passenger_startup.js" 2>/dev/null; then
    echo -e "${YELLOW}⚠️  passenger_startup.js no encontrado, copiando...${NC}"
    scp "$LOCAL_BACKEND_DIR/passenger_startup.js" "$SSH_HOST:$REMOTE_BACKEND_DIR/"
fi

echo -e "${GREEN}✅ Archivos de despliegue verificados${NC}"
echo ""

# Paso 6b: Sincronizar modelo ONNX (gitignored, ~290MB)
echo -e "${BLUE}🧠 Verificando modelo TranSalNet...${NC}"
LOCAL_MODEL="$LOCAL_BACKEND_DIR/models/transalnet_res.onnx"
REMOTE_MODEL="$REMOTE_BACKEND_DIR/models/transalnet_res.onnx"

if [ -f "$LOCAL_MODEL" ]; then
    MODEL_EXISTS=$(run_remote "test -f $REMOTE_MODEL && echo 'yes' || echo 'no'")
    if [ "$MODEL_EXISTS" = "no" ]; then
        echo -e "${YELLOW}⚠️  Modelo no encontrado en servidor, subiendo (~290MB)...${NC}"
        run_remote "mkdir -p $REMOTE_BACKEND_DIR/models"
        rsync -avz --progress "$LOCAL_MODEL" "$SSH_HOST:$REMOTE_MODEL"
        echo -e "${GREEN}✅ Modelo subido${NC}"
    else
        echo -e "${GREEN}✅ Modelo ya existe en servidor${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Modelo no encontrado localmente ($LOCAL_MODEL) — Attention Prediction no funcionará${NC}"
fi
echo ""

# Paso 7: Probar que el servidor puede iniciar
echo -e "${BLUE}🧪 Probando inicio del servidor...${NC}"
echo -e "${YELLOW}   (Esto puede tomar unos segundos)${NC}"

# Intentar iniciar el servidor en background y verificar que no crashee inmediatamente
TEST_RESULT=$(run_remote "cd $REMOTE_BACKEND_DIR && timeout 5 npm start 2>&1 || echo 'TIMEOUT_OK'" || echo "ERROR")

if echo "$TEST_RESULT" | grep -q "Server running\|TIMEOUT_OK"; then
    echo -e "${GREEN}✅ Servidor puede iniciar correctamente${NC}"
else
    echo -e "${RED}❌ Error al iniciar el servidor${NC}"
    echo "   Output:"
    echo "$TEST_RESULT" | head -20
    echo ""
    echo -e "${YELLOW}⚠️  Revisa la configuración en .env${NC}"
fi
echo ""

# Paso 8: Mostrar información de configuración
echo -e "${BLUE}📋 Información de Despliegue${NC}"
echo "=================================================="
echo ""
echo -e "${GREEN}✅ Backend desplegado en:${NC}"
echo "   $REMOTE_BACKEND_DIR"
echo ""
echo -e "${GREEN}✅ Archivos importantes:${NC}"
echo "   - Código fuente: $REMOTE_BACKEND_DIR/src/"
echo "   - Compilado: $REMOTE_BACKEND_DIR/dist/"
echo "   - Entry point: $REMOTE_BACKEND_DIR/server-cpanel.js"
echo "   - Variables: $REMOTE_BACKEND_DIR/.env"
echo ""

# Paso 9: Instrucciones para Passenger
echo -e "${BLUE}📋 Próximos Pasos${NC}"
echo "=================================================="
echo ""
echo "1. Verificar configuración:"
echo "   ssh $SSH_HOST"
echo "   cd $REMOTE_BACKEND_DIR"
echo "   cat .env"
echo ""
echo "2. Probar servidor manualmente:"
echo "   cd $REMOTE_BACKEND_DIR"
echo "   npm start"
echo "   # Deberías ver: 'Server running on port 3000'"
echo ""
echo "3. Configurar Passenger en cPanel:"
echo "   - Ir a: Applications → Node.js"
echo "   - Crear nueva aplicación"
echo "   - Node.js version: 24.12.0"
echo "   - Application root: $REMOTE_BACKEND_DIR"
echo "   - Application URL: /api (o subdominio)"
echo "   - Application startup file: server-cpanel.js"
echo ""
echo "4. Verificar que funciona:"
echo "   curl https://emotio.cx/api/health"
echo "   # Debería responder: {\"status\":\"healthy\",...}"
echo ""
echo -e "${GREEN}✅ Despliegue del backend completado${NC}"
echo ""
