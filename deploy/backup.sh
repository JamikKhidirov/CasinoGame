#!/usr/bin/env bash
# ============================================
#  🎰 Casino Game — backup SQLite
#
#  Делает целостную копию базы на работающем контейнере
#  (SQLite backup API, без остановки игры), сжимает и
#  удаляет копии старше KEEP дней.
#
#  Запуск:
#    sudo bash deploy/backup.sh
#    BACKUP_DIR=/mnt/backups KEEP=30 sudo bash deploy/backup.sh
#
#  Cron (каждый день в 03:00):
#    0 3 * * * /opt/casino/deploy/backup.sh >> /var/log/casino-backup.log 2>&1
# ============================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
CONTAINER="${CONTAINER:-casino-game}"
KEEP="${KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/casino-$STAMP.db"

if ! command -v docker >/dev/null 2>&1; then
	echo "[x] Docker не найден" >&2
	exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
	echo "[x] Контейнер $CONTAINER не запущен" >&2
	exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "==> Копирую базу из $CONTAINER"
# sqlite3 CLI в образе нет, зато есть python3 и модуль sqlite3.
# conn.backup() безопасен на живой базе (в отличие от простого cp с WAL).
docker exec "$CONTAINER" python -c '
import sqlite3

src = sqlite3.connect("/app/data/casino.db")
dst = sqlite3.connect("/app/data/backup.db")
with dst:
    src.backup(dst)
dst.close()
src.close()
'

docker cp "$CONTAINER:/app/data/backup.db" "$TARGET"
docker exec "$CONTAINER" rm -f /app/data/backup.db
chmod 600 "$TARGET"

if command -v gzip >/dev/null 2>&1; then
	gzip -9 "$TARGET"
	TARGET="$TARGET.gz"
fi

SIZE="$(du -h "$TARGET" | cut -f1)"
echo "==> Готово: $TARGET ($SIZE)"

if [[ "$KEEP" =~ ^[0-9]+$ ]] && (( KEEP > 0 )); then
	find "$BACKUP_DIR" -maxdepth 1 -type f -name 'casino-*.db*' -mtime "+$KEEP" -print -delete
fi

echo "==> Всего копий: $(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'casino-*.db*' | wc -l)"
