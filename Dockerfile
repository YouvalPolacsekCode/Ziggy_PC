# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
# Cache-bust: BuildKit was concluding the `RUN npm run build` layer was
# unchanged across commits even when AIChat / Settings had obviously
# different bytes — `COPY frontend/ ./` was hashing identically when no
# layer above it had changed (npm install layer pinned by lockfile),
# and the subsequent RUN didn't reference any per-commit input.
# Result: silently stale dist/ in the final image while /api/version
# reported the new SHA. Wrong answer to "is my push deployed?".
#
# BuildKit's cache key for a RUN step includes the *values* of ARGs the
# RUN actually references. So we declare ARG GIT_SHA inside this stage
# AND reference it in the RUN command — every commit changes the SHA,
# which changes the cache key, which forces `npm run build` to rerun.
# (ENV alone doesn't do it: the RUN has to read the ARG.)
ARG GIT_SHA=dev
RUN echo "frontend build for $GIT_SHA" && npm run build

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

# Hub-mode defaults. Every home is a mini-PC hub post-Phase-5; the Oracle
# per-home cloud VM path is gone. Docker Compose's ziggy service overrides
# any of these at runtime as needed.
ENV CLOUD_MODE=false
ENV HOME_ID=""
ENV HOME_NAME="My Home"
ENV HOME_TYPE=hub
ENV RELAY_URL=""
ENV RELAY_SECRET=""
ENV TUNNEL_URL=""
ENV HA_URL=""
ENV HA_TOKEN=""
# Hub config lives on the host bind-mount at ./config/settings.yaml.
ENV ZIGGY_CONFIG_PATH=/app/config/settings.yaml

EXPOSE 8001

CMD ["python", "-m", "uvicorn", "backend.server:app", \
     "--host", "0.0.0.0", "--port", "8001", "--log-level", "warning"]
