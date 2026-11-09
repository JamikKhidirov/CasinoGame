#!/usr/bin/env bash
# Запускает веб-сервер и Telegram-бота в одном контейнере.
set -u

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
node server.js &
NODE_PID=$!

echo "🤖 Запуск Telegram-бота..."
python main.py &
BOT_PID=$!

# Ждём завершения любого из процессов. Если один упал — контейнер
# перезапустится (restart: unless-stopped в docker-compose).
wait -n "$NODE_PID" "$BOT_PID"
STATUS=$?

echo "⚠️  Один из процессов завершился (код $STATUS). Останавливаем второй."
cleanup
exit "$STATUS"
