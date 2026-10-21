# 📦 Развёртывание Casino Game

Подробная инструкция по запуску всего стека одной Docker-командой.

---

## 🚀 Быстрый старт

```bash
# 1. Клонируйте репозиторий
git clone https://github.com/JamikKhidirov/CasinoGame.git
cd CasinoGame

# 2. Подготовьте переменные окружения
cp .env.example .env

# 3. Отредактируйте .env — обязательно укажите:
#    BOT_TOKEN=ваш_токен_от_BotFather
#    ADMIN_IDS=ваш_телеграм_id

# 4. Запустите всё одной командой
docker-compose up -d --build
```

После успешного запуска:

| Сервис | URL |
|--------|-----|
| 🌐 Веб-сайт | `http://localhost:3000` |
| 🛠 Админ-панель | `http://localhost:3000/admin.html` |
| ❤️ Health check | `http://localhost:3000/health` |
| 🤖 Telegram Bot | работает через polling |

---

## 📋 Требования

- Docker 20.10+
- Docker Compose v2
- Минимум 1 ГБ RAM (для Node.js + Python)

---

## 📁 Файлы конфигурации

### `.env` (обязательно создать)

```env
# Telegram Bot
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
ADMIN_IDS=123456789

# Web Server
PORT=3000
ADMIN_PASSWORD=admin123
CORS_ORIGIN=*

# Database
DB_PATH=/app/data/casino.db

# Economy
START_BALANCE=1000
START_POINTS=2000
MIN_BET=1
MAX_BET=1000000
COMMISSION_PERCENT=0

# Timeouts
JOIN_TIMEOUT=15
MOVE_TIMEOUT=30
DICE_ROLL_DELAY=3
RESULT_MSG_TTL=15
BANNER_CHECK_INTERVAL=30
```

### `docker-compose.yml`

```yaml
version: "3.8"
services:
  casino:
    build: .
    image: casino-game:latest
    container_name: casino-game
    env_file:
      - .env
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - casino_data:/app/data
    stop_grace_period: 10s
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

volumes:
  casino_data:
```

---

## 🛠 Команды Docker

| Команда | Описание |
|---------|----------|
| `docker-compose up -d --build` | Собрать и запустить в фоне |
| `docker-compose logs -f` | Посмотреть логи в реальном времени |
| `docker-compose ps` | Статус контейнера |
| `docker-compose down` | Остановить и удалить контейнер |
| `docker-compose restart` | Перезапустить |
| `docker-compose down -v` | Остановить и удалить данные (включая БД) |

---

## 🐛 Troubleshooting

### Контейнер не стартует
```bash
docker-compose logs casino
```
Чаще всего проблема в отсутствующем `BOT_TOKEN` в `.env`.

### Порт 3000 занят
Измените в `docker-compose.yml`:
```yaml
ports:
  - "8080:3000"  # доступно на localhost:8080
```

### База данных не сохраняется
Убедитесь, что том `casino_data` не удаляется. Используйте `docker-compose down` (без `-v`).

### Бот не отвечает
Проверьте `BOT_TOKEN` и что у бота выключен приватный режим в BotFather (`/setprivacy` → off).

---

## 📊 Мониторинг

Health-check эндпоинт:
```bash
curl http://localhost:3000/health
# Ответ: {"status":"ok","timestamp":"...","rooms":0}
```

Docker healthcheck автоматически перезапускает контейнер при сбое.

---

## 🔗 Связанная документация

- [🏗 ARCHITECTURE.md](ARCHITECTURE.md) — архитектура системы
- [🔗 API.md](API.md) — API reference
- [📖 README.md](README.md) — основная документация
