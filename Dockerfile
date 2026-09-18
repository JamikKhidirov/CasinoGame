# ============================================
#  🎰 Casino Bot — production-образ (aiogram 3)
# ============================================
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DB_PATH=/app/data/casino.db

WORKDIR /app

# 1) Зависимости отдельным слоем — кеш не сбрасывается при правках кода
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 2) Исходники бота
COPY main.py config.py database.py keyboards.py utils.py ./
COPY handlers/ ./handlers/
COPY services/ ./services/

# 3) Непривилегированный пользователь + папка для SQLite (том)
RUN mkdir -p /app/data \
    && useradd --create-home --uid 1000 bot \
    && chown -R bot:bot /app
USER bot

# 4) Данные (casino.db) живут в томе и не теряются при пересборке
VOLUME ["/app/data"]

# 5) Liveness: PID 1 — это python, проверяем что он жив
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import os; os.kill(1, 0)"]

CMD ["python", "main.py"]

