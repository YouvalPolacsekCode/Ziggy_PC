#!/usr/bin/env bash
# Ziggy Cloudflare Tunnel setup — run AFTER `cloudflared tunnel login`
set -e

CLOUDFLARED="/c/Program Files (x86)/cloudflared/cloudflared.exe"
TUNNEL_NAME="ziggy-remote"
ZIGGY_PORT=8001
CONFIG_DIR="$HOME/.cloudflared"

echo "=== Ziggy Cloudflare Tunnel Setup ==="

# Step 1: Create the named tunnel
echo "[1/4] Creating tunnel: $TUNNEL_NAME"
"$CLOUDFLARED" tunnel create "$TUNNEL_NAME" 2>&1
TUNNEL_ID=$("$CLOUDFLARED" tunnel list --output json 2>/dev/null | python -c "
import sys, json
tunnels = json.load(sys.stdin)
for t in tunnels:
    if t.get('name') == '$TUNNEL_NAME':
        print(t['id'])
        break
" 2>/dev/null)
echo "Tunnel ID: $TUNNEL_ID"

# Step 2: Write config.yml
echo "[2/4] Writing config to $CONFIG_DIR/config.yml"
cat > "$CONFIG_DIR/config.yml" << EOF
tunnel: $TUNNEL_NAME
credentials-file: $CONFIG_DIR/$TUNNEL_ID.json

ingress:
  - hostname: ${TUNNEL_NAME}.cfargotunnel.com
    service: http://localhost:$ZIGGY_PORT
  - service: http_status:404
EOF

echo "Config written."

# Step 3: Get the tunnel URL
echo "[3/4] Your permanent tunnel URL (no domain needed):"
echo "  https://${TUNNEL_NAME}.cfargotunnel.com"
echo ""
echo "  NOTE: This URL is stable as long as the tunnel exists."
echo "  Bookmark it on your phone."

# Step 4: Install as Windows service (auto-start on boot)
echo "[4/4] Installing as Windows service (runs on startup)..."
"$CLOUDFLARED" service install 2>&1 || echo "  (Service install may need admin rights — see instructions below)"

echo ""
echo "=== DONE ==="
echo "Tunnel URL: https://${TUNNEL_NAME}.cfargotunnel.com"
echo ""
echo "To start now:        '$CLOUDFLARED' tunnel run $TUNNEL_NAME"
echo "To start as service: net start cloudflared  (run as Admin)"
echo "To check status:     '$CLOUDFLARED' tunnel info $TUNNEL_NAME"
