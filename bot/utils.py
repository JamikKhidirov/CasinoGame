import html
import time

TYPE_NAMES = {
    "deposit": "💵 Пополнение",
    "withdraw": "💸 Снятие",
    "bet": "🎲 Ставка",
    "win": "🏆 Выигрыш",
    "refund": "↩️ Возврат",
    "promo": "🎁 Промокод",
    "hold": "💳 Вывод (заморозка)",
    "transfer": "📤 Перевод",
    "donation": "💝 Донат",
    "convert": "🔄 Обмен",
    "points": "⭐ Очки",
    "points_bet": "🎲 Ставка (⭐)",
    "points_win": "🏆 Выигрыш (⭐)",
}


def esc(value) -> str:
    """Экранирование для HTML-разметки Telegram."""
    return html.escape(str(value))


def fmt(value) -> str:
    """Форматирование чисел с пробелами-разделителями: 1 000 000."""
    try:
        return f"{int(value):,}".replace(",", " ")
    except (TypeError, ValueError):
        return str(value)


def fmt_ts(ts: int) -> str:
    return time.strftime("%d.%m %H:%M", time.localtime(ts))


def type_name(t: str) -> str:
    return TYPE_NAMES.get(t, t)
