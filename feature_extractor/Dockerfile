# feature-extractor — reads pump_telemetry, writes pump_features.
# Build context is the REPO ROOT (so common/ is reachable):
#   docker build -f feature_extractor/Dockerfile -t edgemind/feature-extractor .

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY feature_extractor/requirements.txt .
RUN pip install -r requirements.txt

COPY common/ ./common/
COPY feature_extractor/features.py feature_extractor/main.py ./

ENV INFLUX_URL=http://influxdb:8086 \
    INFLUX_ORG=edgemind \
    INFLUX_BUCKET=pump_station \
    CYCLE_S=30 \
    WINDOW=5m \
    LEAK_MODE=false \
    LOG_LEVEL=INFO

CMD ["python", "main.py"]
