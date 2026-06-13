FROM python:3.11-slim

WORKDIR /app

# Copy shared contract first (common/ is at repo root, build context = repo root)
COPY common/ common/

# Install dependencies
COPY batch_sync/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY batch_sync/ batch_sync/

# Run from /app so `from common.contract import ...` resolves correctly.
WORKDIR /app/batch_sync

ENV INFLUX_URL=http://data-historian:8086 \
    INFLUX_TOKEN="" \
    INFLUX_ORG=edgemind \
    INFLUX_BUCKET=pump_station \
    EXPORTS_DIR=/data/exports \
    MOCK_UPLOAD_URL=http://mock-upload:9000 \
    SCHEDULE_S=300 \
    FAULT_WINDOW_MIN=30 \
    HOST=0.0.0.0 \
    PORT=8091 \
    LOG_LEVEL=INFO

EXPOSE 8091

CMD ["python", "main.py"]
