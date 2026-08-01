import os

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _int_list(name: str) -> list[int]:
    return [int(x) for x in os.getenv(name, "").split(",") if x.strip().lstrip("-").isdigit()]


# ==== Основное ====
BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
ADMIN_IDS = _int_list("ADMIN_IDS")

# ==== Экономика ====
START_BALANCE = _int("START_BALANCE", 1000)        # стартовый баланс новичка
MIN_BET = _int("MIN_BET", 1)                        # минимальная ставка
MAX_BET = _int("MAX_BET", 1000000)                  # максимальная ставка
COMMISSION_PERCENT = _int("COMMISSION_PERCENT", 0)  # комиссия казино в %
WITHDRAW_MIN = _int("WITHDRAW_MIN", 1000)           # минимальная сумма вывода
WITHDRAW_NOTE = os.getenv("WITHDRAW_NOTE", "Выплаты производятся в виде Telegram Premium")

# ==== Донат по реквизитам карты (настраивается админом) ====
DONATE_CARD_TYPE = os.getenv("DONATE_CARD_TYPE", "Сбербанк").strip()   # тип карты / банк
DONATE_CARD_NUMBER = os.getenv("DONATE_CARD_NUMBER", "").strip()       # номер карты
DONATE_CARD_NAME = os.getenv("DONATE_CARD_NAME", "").strip()           # ФИО получателя

# ==== Очки бота (⭐) — бесплатная валюта для игры с ботом ====
START_POINTS = _int("START_POINTS", 2000)   # стартовые очки новичка (игра с ботом бесплатна)
POINTS_MIN_BET = _int("POINTS_MIN_BET", 10)
POINTS_MAX_BET = _int("POINTS_MAX_BET", 100000)
POINTS_BUY_RATE = _int("POINTS_BUY_RATE", 150)  # 100 💰 -> 150 ⭐ (курс 1 💰 = 1.5 ⭐, выгодно)
POINTS_SELL_RATE = _int("POINTS_SELL_RATE", 60)  # 100 ⭐ -> 60 💰 (курс 1 ⭐ = 0.6 💰)

# ==== Тайминги ====
JOIN_TIMEOUT = _int("JOIN_TIMEOUT", 15)   # сколько секунд комната ждёт соперника
MOVE_TIMEOUT = _int("MOVE_TIMEOUT", 30)   # сколько секунд бот ждёт ход игрока
DICE_ROLL_DELAY = _int("DICE_ROLL_DELAY", 3)  # имитация «вращения кубика» перед раскрытием результата, сек
RESULT_MSG_TTL = _int("RESULT_MSG_TTL", 15)  # через сколько сек удалять сообщение с результатом
BANNER_CHECK_INTERVAL = _int("BANNER_CHECK_INTERVAL", 30)  # сек между проверками авторассылки

# ==== БД ====
DB_PATH = os.getenv("DB_PATH", "casino.db")

# ==== Настройки, которые админ может менять прямо из панели (/admin → Настройки) ====
# key -> (название, значение по умолчанию из .env)
SETTINGS = {
    "COMMISSION_PERCENT": ("Комиссия казино, %", COMMISSION_PERCENT),
    "MIN_BET": ("Мин. ставка 💰", MIN_BET),
    "MAX_BET": ("Макс. ставка 💰", MAX_BET),
    "POINTS_MIN_BET": ("Мин. ставка ⭐", POINTS_MIN_BET),
    "POINTS_MAX_BET": ("Макс. ставка ⭐", POINTS_MAX_BET),
    "POINTS_BUY_RATE": ("Курс 💰→⭐: 100 💰 = N ⭐", POINTS_BUY_RATE),
    "POINTS_SELL_RATE": ("Курс ⭐→💰: 100 ⭐ = N 💰", POINTS_SELL_RATE),
    "WITHDRAW_MIN": ("Мин. вывод 💰", WITHDRAW_MIN),
    "JOIN_TIMEOUT": ("Ожидание соперника, сек", JOIN_TIMEOUT),
    "MOVE_TIMEOUT": ("Ожидание хода, сек", MOVE_TIMEOUT),
    "DICE_ROLL_DELAY": ("Имитация броска, сек", DICE_ROLL_DELAY),
    "RESULT_MSG_TTL": ("Удаление результата, сек", RESULT_MSG_TTL),
    "START_BALANCE": ("Стартовый баланс 💰", START_BALANCE),
    "START_POINTS": ("Стартовые очки ⭐", START_POINTS),
    "DONATE_CARD_TYPE": ("Донат: тип карты/банк 🏦", DONATE_CARD_TYPE),
    "DONATE_CARD_NUMBER": ("Донат: номер карты 💳", DONATE_CARD_NUMBER),
    "DONATE_CARD_NAME": ("Донат: получатель (ФИО) 👤", DONATE_CARD_NAME),
}


def load_runtime_settings() -> None:
    """Применяет настройки из БД поверх значений из .env (вызывается после init_db).
    Числовые настройки приводятся к int, строковые (донат-реквизиты) остаются строками."""
    from database import get_all_settings
    for key, value in get_all_settings().items():
        if key in SETTINGS:
            default = SETTINGS[key][1]
            if isinstance(default, str):
                globals()[key] = value
            else:
                try:
                    globals()[key] = int(value)
                except (TypeError, ValueError):
                    pass


def check() -> list[str]:
    errors = []
    if not BOT_TOKEN:
        errors.append("BOT_TOKEN не задан в файле .env")
    return errors
