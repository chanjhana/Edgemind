FROM python:3.11-slim

WORKDIR /app

COPY mock_upload/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY mock_upload/ mock_upload/

WORKDIR /app/mock_upload

ENV HOST=0.0.0.0 \
    PORT=9000 \
    LOG_LEVEL=INFO

EXPOSE 9000

CMD ["python", "main.py"]
