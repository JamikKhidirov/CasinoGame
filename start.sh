#!/usr/bin/env bash
# Запускает веб-сервер и Telegram-бота в одном контейнере.
set -u

cd /app || exit 1
# configs/ — модуль config, bot/ — database, handlers, services, keyboards, utils
export PYTHONPATH="/app/configs:/app/bot${PYTHONPATH:+:$PYTHONPATH}"

NODE_PID=""
BOT_PID=""

cleanup() {
  echo "🛑 Останавливаем процессы..."
  [ -n "$NODE_PID" ] && kill -TERM "$NODE_PID" 2>/dev/null || true
  [ -n "$BOT_PID" ] && kill -TERM "$BOT_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}

trap cleanup TERM INT

echo "🚀 Запуск веб-сервера..."
node /app/casino/server.js &
NODE_PID=$!

echo "🤖 Запуск Telegram-бота..."
python /app/bot/main.py &
BOT_PID=$!

# Ждём завершения любого из процессов. Если один упал — контейнер
# перезапустится (restart: unless-stopped в docker-compose).
wait -n "$NODE_PID" "$BOT_PID"
STATUS=$?

echo "⚠️  Один из процессов завершился (код $STATUS). Останавливаем второй."
cleanup
exit "$STATUS"
