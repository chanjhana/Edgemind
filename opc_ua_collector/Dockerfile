# opc-ua-collector — asyncua subscription client → InfluxDB.
# Build context is the REPO ROOT (so common/ is reachable):
#   docker build -f opc_ua_collector/Dockerfile -t edgemind/opc-ua-collector .

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY opc_ua_collector/requirements.txt .
RUN pip install -r requirements.txt

# Shared contract package + collector source (flat in /app).
COPY common/ ./common/
COPY opc_ua_collector/collector.py opc_ua_collector/main.py ./

ENV INFLUX_URL=http://influxdb:8086 \
    INFLUX_ORG=edgemind \
    INFLUX_BUCKET=pump_station \
    LOG_LEVEL=INFO

CMD ["python", "main.py"]
