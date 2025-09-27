FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps (ssl/certs already in slim)
RUN adduser --disabled-password --gecos "" appuser

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

USER appuser

ENV PORT=8080
EXPOSE 8080
# If you expect >1 CPU, you can add workers with --workers, but 1 is fine.
CMD ["bash", "-lc", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
