#!/usr/bin/env bash
# ============================================
#  🎰 Casino Game — установка на VPS
#  Ubuntu 22.04 / 24.04 (Debian 12 тоже подойдёт)
#
#  Запуск:
#    sudo bash deploy/install.sh
#
#  Скрипт:
#    1. ставит Docker, git, curl, python3;
#    2. спрашивает BOT_TOKEN, ADMIN_IDS, пароль и домен;
#    3. создаёт .env;
#    4. открывает 80/443 в ufw (если firewall включён);
#    5. собирает образ и поднимает сайт + Caddy с HTTPS.
# ============================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/JamikKhidirov/CasinoGame.git}"
COMPOSE_FILE="docker-compose.vps.yml"

info() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || fail "Скрипт рассчитан на Linux (Ubuntu/Debian)."
if [[ $EUID -eq 0 ]]; then SUDO=""; else SUDO="sudo"; fi

# ---------- 1. Папка проекта ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/../$COMPOSE_FILE" ]]; then
	APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
	info "Использую существующий проект: $APP_DIR"
else
	APP_DIR="${APP_DIR:-/opt/casino}"
	if [[ -d "$APP_DIR/.git" ]]; then
		info "Обновляю код в $APP_DIR"
		$SUDO git -C "$APP_DIR" pull --ff-only
	else
		info "Клонирую репозиторий в $APP_DIR"
		$SUDO mkdir -p "$(dirname "$APP_DIR")"
		$SUDO git clone "$REPO_URL" "$APP_DIR"
	fi
fi
cd "$APP_DIR"

# ---------- 2. Базовые пакеты ----------
if ! command -v curl >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
	info "Устанавливаю базовые пакеты"
	$SUDO apt-get update -y
	$SUDO apt-get install -y curl git python3 ca-certificates
fi

# ---------- 3. Docker ----------
if ! command -v docker >/dev/null 2>&1; then
	info "Устанавливаю Docker (официальный скрипт get.docker.com)"
	curl -fsSL https://get.docker.com | $SUDO sh
	$SUDO systemctl enable --now docker
fi
if docker info >/dev/null 2>&1; then
	DOCKER="docker"
else
	DOCKER="$SUDO docker"
fi
$DOCKER compose version >/dev/null 2>&1 || fail "Не найден Docker Compose v2. Установите пакет docker-compose-plugin и запустите скрипт снова."

if [[ -n "$SUDO" && -n "${SUDO_USER:-}" ]]; then
	if ! id -nG "$SUDO_USER" | grep -qw docker; then
		$SUDO usermod -aG docker "$SUDO_USER" || true
		warn "Пользователь $SUDO_USER добавлен в группу docker — после перезахода по SSH sudo для docker не нужен."
	fi
fi

# ---------- 4. .env ----------
ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
	cp "$APP_DIR/.env.example" "$ENV_FILE"
	info "Создан .env из .env.example"
fi
chmod 600 "$ENV_FILE"

# Аккуратно меняет KEY=value, не ломаясь на спецсимволах в пароле
set_env() {
	KEY="$1" VALUE="$2" python3 - "$ENV_FILE" <<'PY'
import os
import re
import sys

path = sys.argv[1]
key = os.environ["KEY"]
value = os.environ["VALUE"]
with open(path, encoding="utf-8") as fh:
    lines = fh.read().splitlines()

out, replaced = [], False
for line in lines:
    if re.match(rf"\s*{re.escape(key)}\s*=", line):
        if not replaced:
            out.append(f"{key}={value}")
            replaced = True
        continue
    out.append(line)
if not replaced:
    out.append(f"{key}={value}")

with open(path, "w", encoding="utf-8", newline="\n") as fh:
    fh.write("\n".join(out) + "\n")
PY
}

env_has_value() {
	grep -qE "^[[:space:]]*$1=.+" "$ENV_FILE"
}

# Публичный IPv4 сервера — нужен для бесплатного домена sslip.io
detect_public_ip() {
	local ip=""
	for url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
		ip="$(curl -4 -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]' || true)"
		if [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
			echo "$ip"
			return 0
		fi
	done
	return 1
}

if ! env_has_value BOT_TOKEN || grep -q '^BOT_TOKEN=123456789:REPLACE' "$ENV_FILE"; then
	read -rp "Токен бота от @BotFather (BOT_TOKEN): " value
	[[ -n "$value" ]] || fail "BOT_TOKEN обязателен."
	set_env BOT_TOKEN "$value"
fi

if ! env_has_value ADMIN_IDS || grep -qE '^ADMIN_IDS=123456789$' "$ENV_FILE"; then
	read -rp "Ваш Telegram ID для админки (ADMIN_IDS): " value
	[[ "$value" =~ ^[0-9]+(,[0-9]+)*$ ]] || fail "ADMIN_IDS — числа через запятую, например 123456789"
	set_env ADMIN_IDS "$value"
fi

if ! env_has_value ADMIN_PASSWORD || grep -q '^ADMIN_PASSWORD=change_me' "$ENV_FILE"; then
	read -rsp "Пароль веб-админки (Enter — сгенерировать): " value
	echo
	if [[ -z "$value" ]]; then
		value="$(python3 -c 'import secrets; print(secrets.token_urlsafe(12))')"
		info "Сгенерирован пароль админки: $value"
		warn "Сохраните его: он понадобится для входа на /admin."
	fi
	set_env ADMIN_PASSWORD "$value"
fi

if ! env_has_value DOMAIN; then
	echo
	echo "Домен должен уже указывать A-записью на IP этого сервера."
	read -rp "Домен (например casino.example.com) или Enter — бесплатный sslip.io: " value
	value="${value%/}"
	if [[ -z "$value" ]]; then
		ip="$(detect_public_ip || true)"
		[[ -n "$ip" ]] || fail "Не удалось определить публичный IP. Введите домен вручную."
		value="${ip//./-}.sslip.io"
		info "Домен не указан — использую бесплатный: $value"
	fi
	if [[ "$value" == http://* ]]; then
		web_url="$value"
		warn "Выбран режим без HTTPS. Telegram Mini App работать не будет — только проверка в браузере."
	else
		value="${value#https://}"
		web_url="https://$value"
	fi
	set_env DOMAIN "$value"
	set_env WEB_URL "$web_url"
else
	domain_value="$(grep -E '^DOMAIN=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
	if [[ "$domain_value" == http://* ]]; then
		web_url="$domain_value"
	else
		web_url="https://${domain_value#https://}"
	fi
	if grep -qE '^WEB_URL=https?://localhost' "$ENV_FILE"; then
		set_env WEB_URL "$web_url"
	fi
fi

# ---------- 5. Firewall ----------
if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
	info "Открываю порты 22, 80, 443 в ufw"
	$SUDO ufw allow 22/tcp >/dev/null 2>&1 || true
	$SUDO ufw allow 80/tcp >/dev/null
	$SUDO ufw allow 443/tcp >/dev/null
	$SUDO ufw allow 443/udp >/dev/null
fi
if command -v firewall-cmd >/dev/null 2>&1 && $SUDO firewall-cmd --state >/dev/null 2>&1; then
	info "Открываю порты 80/443 в firewalld"
	$SUDO firewall-cmd --permanent --add-service=http >/dev/null
	$SUDO firewall-cmd --permanent --add-service=https >/dev/null
	$SUDO firewall-cmd --reload >/dev/null
fi

# ---------- 6. Запуск ----------
info "Собираю образ и запускаю стек (первая сборка — 5–10 минут)..."
$DOCKER compose -f "$COMPOSE_FILE" up -d --build

info "Жду, пока приложение пройдёт healthcheck..."
status="starting"
for _ in $(seq 1 60); do
	status="$($DOCKER inspect -f '{{.State.Health.Status}}' casino-game 2>/dev/null || echo starting)"
	[[ "$status" == "healthy" ]] && break
	sleep 5
done

echo
if [[ "$status" == "healthy" ]]; then
	info "Готово. Приложение работает."
else
	warn "Приложение ещё не стало healthy (статус: $status). Смотрите логи:"
	echo "    $DOCKER compose -f $COMPOSE_FILE logs -f casino"
fi

echo
echo "────────────────────────────────────────────"
echo " Сайт:    ${web_url:-см. DOMAIN в .env}"
echo " Админка: ${web_url:-https://ваш-домен}/admin"
echo
echo " Проверка:   curl -fsS ${web_url:-https://ваш-домен}/health"
echo " Логи:       $DOCKER compose -f $COMPOSE_FILE logs -f"
echo " Перезапуск: $DOCKER compose -f $COMPOSE_FILE restart"
echo " Обновление: git pull && $DOCKER compose -f $COMPOSE_FILE up -d --build"
echo " Backup:     sudo bash deploy/backup.sh"
echo "────────────────────────────────────────────"
warn "Сертификат Caddy выпускает 1–2 минуты после старта. Если сайт не открылся — проверьте DNS и логи caddy."
echo "Не забудьте указать ${web_url:-https://ваш-домен} в @BotFather (/setmenubutton)."
