#!/bin/bash

# Script para desplegar research-frontend a cPanel
# Construye el frontend y lo despliega en ~/public_html/research

set -e

SSH_HOST="cpanel-emotio"
REMOTE_RESEARCH_DIR="~/public_html/research"
LOCAL_RESEARCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../research-frontend" && pwd)"

# Configurar ControlMaster para reutilizar conexiones SSH (evita múltiples passphrases)
SSH_CONTROL_PATH="/tmp/ssh-control-%r@%h:%p"
SSH_OPTS="-o ControlMaster=auto -o ControlPath=$SSH_CONTROL_PATH -o ControlPersist=300"

# Función para limpiar el socket de control al finalizar
cleanup_ssh() {
    ssh -O exit "$SSH_HOST" 2>/dev/null || true
}
trap cleanup_ssh EXIT

# Verificar si la clave está en ssh-agent, si no, agregarla automáticamente
if ! ssh-add -l 2>/dev/null | grep -q "cpanel"; then
    echo "🔑 Agregando clave SSH al agente..."
    SSH_KEY="$HOME/.ssh/cpanel_cursor"
    SSH_PASSPHRASE="$(grep '^CPANEL_SSH_PASSPHRASE=' "$(dirname "${BASH_SOURCE[0]}")/../.env.claude" | cut -d= -f2-)"
    if [ -f "$SSH_KEY" ]; then
        # Usar sshpass para agregar la clave automáticamente
        SSHPASS="$SSH_PASSPHRASE" sshpass -P "passphrase" -e ssh-add "$SSH_KEY" 2>/dev/null || {
            echo "⚠️  No se pudo agregar la clave automáticamente."
            echo "   Ejecuta manualmente: ssh-add ~/.ssh/cpanel_cursor"
        }
    fi
fi

echo "🚀 Desplegando Research Frontend a cPanel"
echo "=========================================="
echo ""

# Verificar que existe el directorio local
if [ ! -d "$LOCAL_RESEARCH_DIR" ]; then
    echo "❌ Error: No se encontró el directorio research-frontend"
    exit 1
fi

cd "$LOCAL_RESEARCH_DIR"

# 1. Actualizar runtime-config.json
echo "1. Configurando runtime-config.json..."
cat > public/runtime-config.json << 'EOF'
{
  "apiBaseUrl": "https://emotio.cx/api",
  "participantBaseUrl": "https://emotio.cx/participant"
}
EOF
echo "   ✅ runtime-config.json actualizado"

# 2. Instalar dependencias si es necesario
if [ ! -d "node_modules" ]; then
    echo ""
    echo "2. Instalando dependencias..."
    npm install
    echo "   ✅ Dependencias instaladas"
else
    echo ""
    echo "2. Dependencias ya instaladas"
fi

# 3. Construir para producción
echo ""
echo "3. Construyendo para producción..."
npm run build
echo "   ✅ Build completado"

# 4. Verificar que existe el directorio dist
if [ ! -d "dist" ]; then
    echo "❌ Error: No se generó el directorio dist"
    exit 1
fi

ssh $SSH_OPTS "$SSH_HOST" 'mkdir -p "$HOME/public_html/research"'

# 6. Limpiar directorio remoto (excepto .well-known si existe)
echo ""
echo "5. Limpiando directorio remoto..."
ssh $SSH_OPTS "$SSH_HOST" '
    REMOTE_DIR="$HOME/public_html/research"
    cd "$REMOTE_DIR" || exit 1
    find . -mindepth 1 ! -name ".well-known" -exec rm -rf {} + 2>/dev/null || true
    echo "   ✅ Directorio limpiado"
'

# 7. Copiar archivos construidos
echo ""
echo "6. Copiando archivos construidos..."
rsync -avz --delete -e "ssh $SSH_OPTS" \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='src' \
    --exclude='*.ts' \
    --exclude='*.tsx' \
    --exclude='tsconfig*.json' \
    --exclude='vite.config.ts' \
    --exclude='package*.json' \
    --exclude='.env*' \
    --exclude='.gitignore' \
    --exclude='eslint.config.js' \
    --exclude='tailwind.config.js' \
    --exclude='postcss.config.js' \
    "$LOCAL_RESEARCH_DIR/dist/" "$SSH_HOST:$REMOTE_RESEARCH_DIR/"

# Copiar runtime-config.json
scp $SSH_OPTS "$LOCAL_RESEARCH_DIR/public/runtime-config.json" "$SSH_HOST:$REMOTE_RESEARCH_DIR/runtime-config.json"

echo "   ✅ Archivos copiados"

# 7. Configurar .htaccess para cache busting
echo ""
echo "7. Configurando .htaccess con cache control..."
ssh $SSH_OPTS "$SSH_HOST" "cat > $REMOTE_RESEARCH_DIR/.htaccess" << 'HTACCESS_EOF'
# Apache configuration for React Router (SPA)
# Redirects all requests to index.html except for existing files

<IfModule mod_rewrite.c>
  RewriteEngine On
  
  # Handle React Router - redirect all requests to index.html
  # except for files that actually exist
  
  # Explicitly allow .json files (like runtime-config.json)
  RewriteRule \.json$ - [L]
  
  # If the requested file exists, serve it
  RewriteCond %{REQUEST_FILENAME} -f [OR]
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^ - [L]
  
  # Otherwise, redirect to index.html
  RewriteRule ^ index.html [L]
</IfModule>

# Security headers
<IfModule mod_headers.c>
  # Prevent clickjacking
  Header always set X-Frame-Options "SAMEORIGIN"
  
  # XSS Protection
  Header always set X-XSS-Protection "1; mode=block"
  
  # Content type options
  Header always set X-Content-Type-Options "nosniff"
  
  # Referrer policy
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>

# Cache control for static assets - AGGRESSIVE CACHE BUSTING
<IfModule mod_expires.c>
  ExpiresActive On
  
  # Images - cache for 1 year (immutable with hashes)
  ExpiresByType image/jpeg "access plus 1 year"
  ExpiresByType image/png "access plus 1 year"
  ExpiresByType image/gif "access plus 1 year"
  ExpiresByType image/svg+xml "access plus 1 year"
  ExpiresByType image/webp "access plus 1 year"
  
  # Fonts - cache for 1 year (immutable with hashes)
  ExpiresByType font/woff "access plus 1 year"
  ExpiresByType font/woff2 "access plus 1 year"
  ExpiresByType font/ttf "access plus 1 year"
  ExpiresByType font/otf "access plus 1 year"
  
  # CSS and JavaScript - cache for 1 year (Vite uses content hashes)
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  
  # HTML - NO CACHE (always fetch fresh)
  ExpiresByType text/html "access plus 0 seconds"
</IfModule>

# Additional cache control headers to prevent browser/proxy caching of HTML
<IfModule mod_headers.c>
  <FilesMatch "\.(html)$">
    Header set Cache-Control "no-cache, no-store, must-revalidate, max-age=0"
    Header set Pragma "no-cache"
    Header set Expires "0"
  </FilesMatch>
  
  # JSON files (like runtime-config.json) should also not be cached
  <FilesMatch "\.(json)$">
    Header set Cache-Control "no-cache, no-store, must-revalidate, max-age=0"
  </FilesMatch>
  
  # Hashed assets can be cached aggressively
  <FilesMatch "\.(js|css|woff|woff2|ttf|eot|otf|svg|png|jpg|jpeg|gif|webp|ico)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>

# Gzip compression
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript application/json
</IfModule>
HTACCESS_EOF

echo "   ✅ .htaccess configurado con cache busting agresivo"

# 8. Verificar despliegue
echo ""
echo "8. Verificando despliegue..."
REMOTE_FILES=$(ssh $SSH_OPTS "$SSH_HOST" 'ls -1 "$HOME/public_html/research" 2>/dev/null | wc -l')
echo "   Archivos en remoto: $REMOTE_FILES"

if [ "$REMOTE_FILES" -gt 0 ]; then
    echo "   ✅ Despliegue exitoso"
else
    echo "   ⚠️  Advertencia: No se encontraron archivos en el directorio remoto"
fi

echo ""
echo "=========================================="
echo "✅ Despliegue completado"
echo "=========================================="
echo ""
echo "📋 Resumen:"
echo "   - Directorio local: $LOCAL_RESEARCH_DIR"
echo "   - Directorio remoto: $REMOTE_RESEARCH_DIR"
echo "   - API Base URL: https://emotio.cx"
echo ""
echo "🌐 URLs:"
echo "   - Research Frontend: https://emotio.cx/research"
echo "   - Backend API: https://emotio.cx"
echo ""
echo "📝 Próximos pasos:"
echo "   1. Verificar que el frontend carga correctamente"
echo "   2. Probar autenticación con Google"
echo "   3. Verificar que las peticiones al backend funcionan"
echo ""
