FROM python:3.11-slim

WORKDIR /app

# Copy shared contract first (common/ is at repo root, build context = repo root)
COPY common/ common/

# Copy service source
COPY health_scorer/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY health_scorer/ health_scorer/

# Run from /app so `from common.contract import ...` and `from scorer import ...`
# both resolve correctly (common/ and health_scorer/ are siblings under /app).
WORKDIR /app/health_scorer

ENV INFLUX_URL=http://data-historian:8086 \
    INFLUX_TOKEN="" \
    INFLUX_ORG=edgemind \
    INFLUX_BUCKET=pump_station \
    ALERT_MANAGER_URL=http://alert-manager:8090 \
    BATCH_SYNC_URL=http://batch-sync:8091 \
    CYCLE_S=30 \
    LOG_LEVEL=INFO

CMD ["python", "main.py"]
