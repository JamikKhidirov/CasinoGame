# ============================================
#  🎰 Casino Game — полный стек (бот + веб + TMA)
#  Один контейнер: Python-бот, Node.js-сервер, SQLite
# ============================================
FROM python:3.12-slim

# Node.js + инструменты сборки для нативных модулей (sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gnupg2 ca-certificates lsb-release \
    build-essential python3 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    NODE_ENV=production \
    DB_PATH=/app/data/casino.db \
    PORT=3000

WORKDIR /app

# 1) Python зависимости
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 2) Node.js зависимости
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# 3) Исходники бота
COPY main.py config.py database.py keyboards.py utils.py ./
COPY handlers/ ./handlers/
COPY services/ ./services/

# 4) Веб-сервер и фронтенд
COPY server.js start.sh ./
COPY web/ ./web/

# 5) Непривилегированный пользователь + папка для SQLite
RUN mkdir -p /app/data \
    && sed -i 's/\r$//' /app/start.sh \
    && chmod +x /app/start.sh \
    && useradd --create-home --uid 1000 bot \
    && chown -R bot:bot /app
USER bot

# 6) Том для БД (данные переживают пересборку)
VOLUME ["/app/data"]

# 7) Проверка, что веб-сервер отвечает
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["curl", "-fsS", "http://localhost:3000/health"]

# Запускаем оба процесса; контейнер живёт, пока живы оба
CMD ["/app/start.sh"]
