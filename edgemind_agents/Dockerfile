FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

WORKDIR /app

COPY edgemind_agents/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY edgemind_agents/ edgemind_agents/

ENV REDIS_URL=redis://redis-svc.monitoring.svc.cluster.local:6379 \
    PROMETHEUS_URL=http://prometheus-operated.monitoring.svc.cluster.local:9090 \
    LOG_LEVEL=INFO

CMD ["python", "-m", "edgemind_agents.main"]
