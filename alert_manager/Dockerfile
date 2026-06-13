FROM python:3.11-slim

WORKDIR /app

# Copy shared contract (build context = repo root)
COPY common/ common/

# Install dependencies
COPY alert_manager/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy service source
COPY alert_manager/ alert_manager/

WORKDIR /app/alert_manager

ENV ALERTS_DIR=/data/alerts \
    HOST=0.0.0.0 \
    PORT=8090 \
    LOG_LEVEL=INFO

EXPOSE 8090

CMD ["python", "main.py"]
