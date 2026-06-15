# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
# Vite production build — output goes to dist/
RUN npm run build

# ── Stage 2: Python backend with embedded frontend ────────────────────────────
# Python 3.12 matches the Mac dev venv. Required: aioswitcher>=6.0 and
# zha-quirks>=0.0.113 both ship Python 3.12 wheels only, and pinning the
# container behind would break the lockstep with dev.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps — install from requirements.txt, but skip packages that need
# host-level mic / GPIO passthrough we don't grant the container:
#   pyaudio, sounddevice    — need /dev/snd
#   pvporcupine, openwakeword — need a live mic stream
#   RPi.GPIO, gpiozero      — need /dev/gpiomem (Raspberry Pi only)
#
# Voice STT on the backend uses faster-whisper on uploaded audio blobs,
# not the mic libs above. Wake-word inference lives at the edge / native
# host process when used at all (memory: PTT-default).
#
# `anthropic` was in the old hardcoded list but isn't in requirements.txt
# — we install it explicitly so the LLM gateway has both providers.
COPY requirements.txt ./
RUN grep -v -E "^(pyaudio|sounddevice|pvporcupine|openwakeword|RPi\.GPIO|gpiozero)" requirements.txt > /tmp/requirements.txt && \
    pip install --no-cache-dir -r /tmp/requirements.txt && \
    pip install --no-cache-dir anthropic httpx

# Source code
COPY backend/      ./backend/
COPY core/         ./core/
COPY services/     ./services/
COPY interfaces/   ./interfaces/
COPY integrations/ ./integrations/
COPY config/       ./config/
COPY user_files/   ./user_files/
# Tracked-but-runtime-loaded dirs: memory/ holds memory_log.json + task_log.json
# referenced by settings.paths.memory_log / .task_log; routines/ + utils/ are
# imported indirectly via dynamic module loading.
COPY memory/       ./memory/
COPY routines/     ./routines/
COPY utils/        ./utils/

# Frontend build output — FastAPI serves these as static files
COPY --from=frontend-build /frontend/dist ./frontend/dist

# Build-time provenance — scripts/update.ps1 / update.sh pass --build-arg
# GIT_SHA=<sha>. The /api/version endpoint reads this so you can verify
# which commit is running ("did my push actually deploy?").
ARG GIT_SHA=dev
ENV ZIGGY_GIT_SHA=$GIT_SHA
ARG BUILD_TIME=unknown
ENV ZIGGY_BUILD_TIME=$BUILD_TIME

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
