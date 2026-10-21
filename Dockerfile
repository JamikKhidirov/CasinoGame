# ============================================
#  🎰 Casino Game — полный стек (бот + веб + TMA)
# ============================================
FROM python:3.12-slim

# Ставим Node.js для веб-сервера
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gnupg2 ca-certificates lsb-release \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DB_PATH=/app/data/casino.db \
    PORT=3000

WORKDIR /app

# 1) Python зависимости
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 2) Node.js зависимости
COPY package.json ./
RUN npm install --production

# 3) Исходники бота (в папках)
COPY main.py config.py database.py keyboards.py utils.py ./
COPY handlers/ ./handlers/
COPY services/ ./services/

# 4) Веб-файлы
COPY server.js ./
COPY web/ ./web/

# 5) Пользователь + папка для SQLite
RUN mkdir -p /app/data \
    && useradd --create-home --uid 1000 bot \
    && chown -R bot:bot /app
USER bot

# 6) Том для БД
VOLUME ["/app/data"]

# 7) Healthcheck
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import os; os.kill(1, 0)"]

# Запускаем и бота, и веб-сервер
CMD ["sh", "-c", "npm start & python main.py"]
