#!/usr/bin/env bash
# Единая точка входа: Python-бот сам поднимает Node.js-сайт (casino/server.js).
# Отдельно node запускать не нужно.
set -u

cd /app || exit 1
# configs/ — модуль config, bot/ — database, handlers, services, keyboards, utils
export PYTHONPATH="/app/configs:/app/bot${PYTHONPATH:+:$PYTHONPATH}"

# Основной процесс — бот. Он запускает и останавливает веб-сервер сам.
exec python /app/bot/main.py
