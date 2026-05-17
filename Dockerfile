# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
# Vite production build — output goes to dist/
RUN npm run build

# ── Stage 2: Python backend with embedded frontend ────────────────────────────
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps
COPY requirements.txt* ./
RUN pip install --no-cache-dir fastapi uvicorn pydantic aiofiles \
    paho-mqtt requests websockets httpx PyYAML python-multipart \
    openai anthropic feedparser trafilatura yfinance python-dotenv \
    2>/dev/null || pip install --no-cache-dir -r requirements.txt 2>/dev/null || true

# Source code
COPY backend/    ./backend/
COPY core/       ./core/
COPY services/   ./services/
COPY interfaces/ ./interfaces/
COPY config/     ./config/
COPY user_files/ ./user_files/

# Frontend build output — FastAPI serves these as static files
COPY --from=frontend-build /frontend/dist ./frontend/dist

# Cloud home env vars (all overridable at runtime)
ENV CLOUD_MODE=true
ENV HOME_ID=""
ENV HOME_NAME="My Home"
ENV HOME_TYPE=cloud
ENV RELAY_URL=""
ENV RELAY_SECRET=""
ENV TUNNEL_URL=""
ENV HA_URL=""
ENV HA_TOKEN=""
ENV INITIAL_ADMIN_EMAIL=""
ENV INITIAL_ADMIN_PASSWORD=""
# Settings are written to the persistent volume so they survive restarts
ENV ZIGGY_CONFIG_PATH=/app/user_files/settings.yaml

EXPOSE 8001

CMD ["python", "-m", "uvicorn", "backend.server:app", \
     "--host", "0.0.0.0", "--port", "8001", "--log-level", "warning"]
