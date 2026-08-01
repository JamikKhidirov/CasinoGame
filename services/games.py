"""Справочник игр. Все нативные Telegram-игры возвращают число (value),
которое можно честно сравнивать: у кого больше — тот выиграл."""

GAMES: dict[str, dict] = {
    "dice": {"name": "Кубик", "emoji": "🎲", "min": 1, "max": 6},
    "dart": {"name": "Дротики", "emoji": "🎯", "min": 0, "max": 5},
    "football": {"name": "Футбол", "emoji": "⚽", "min": 1, "max": 5},
    "basketball": {"name": "Баскетбол", "emoji": "🏀", "min": 1, "max": 5},
    "bowling": {"name": "Боулинг", "emoji": "🎳", "min": 1, "max": 6},
    "slot": {"name": "Слот", "emoji": "🎰", "min": 0, "max": 63},
    "coin": {"name": "Монетка", "emoji": "🪙", "min": 0, "max": 1},
}

GAME_EMOJIS = {g["emoji"] for g in GAMES.values()}


def get_game(key: str) -> dict | None:
    return GAMES.get(key)
