from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup

from services.games import GAMES

# Тексты кнопок главного меню (держать в одном месте, чтобы не разъезжались с хендлерами)
BTN_CREATE = "🎮 Создать комнату"
BTN_VSBOT = "🤖 Играть с ботом"
BTN_BALANCE = "💰 Баланс"
BTN_HISTORY = "📜 История"
BTN_STATS = "📊 Моя статистика"
BTN_WITHDRAW = "💸 Вывод средств"
BTN_TRANSFER = "📤 Перевод баланса"
BTN_DONATE = "💝 Донат"
BTN_PROMO = "🎁 Промокод"
BTN_TOP = "🏆 Топ игроков"
BTN_CONVERT = "🔄 Обмен очков ⭐"
BTN_DEPOSIT = "💳 Пополнить счёт"


def main_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=BTN_CREATE), KeyboardButton(text=BTN_VSBOT)],
            [KeyboardButton(text=BTN_BALANCE), KeyboardButton(text=BTN_HISTORY)],
            [KeyboardButton(text=BTN_STATS), KeyboardButton(text=BTN_TOP)],
            [KeyboardButton(text=BTN_WITHDRAW), KeyboardButton(text=BTN_TRANSFER)],
            [KeyboardButton(text=BTN_DONATE), KeyboardButton(text=BTN_PROMO)],
            [KeyboardButton(text=BTN_DEPOSIT), KeyboardButton(text=BTN_CONVERT)],
        ],
        resize_keyboard=True,
    )


def games_kb(vs_bot: bool) -> InlineKeyboardMarkup:
    vb = "1" if vs_bot else "0"
    rows = [
        [InlineKeyboardButton(text=f"{g['emoji']} {g['name']}", callback_data=f"choose_game:{vb}:{key}")]
        for key, g in GAMES.items()
    ]
    rows.append([InlineKeyboardButton(text="🚫 Отмена", callback_data="cancel")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def cancel_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="🚫 Отмена", callback_data="cancel")]]
    )


def room_kb(room_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🎮 Присоединиться", callback_data=f"room:join:{room_id}")],
            [InlineKeyboardButton(text="❌ Отменить", callback_data=f"room:cancel:{room_id}")],
        ]
    )


def throw_kb(room) -> InlineKeyboardMarkup:
    if room.game_key == "coin":
        return InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(text="🦅 Орёл", callback_data=f"game:side:{room.room_id}:heads"),
                    InlineKeyboardButton(text="🪙 Решка", callback_data=f"game:side:{room.room_id}:tails"),
                ],
                [InlineKeyboardButton(text="🏳️ Сдаться", callback_data=f"game:fold:{room.room_id}")],
            ]
        )
    g = GAMES[room.game_key]
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=f"{g['emoji']} Бросить", callback_data=f"game:throw:{room.room_id}")],
            [InlineKeyboardButton(text="🏳️ Сдаться", callback_data=f"game:fold:{room.room_id}")],
        ]
    )


def admin_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="📊 Статистика", callback_data="admin:stats")],
            [InlineKeyboardButton(text="⚙️ Настройки", callback_data="admin:settings")],
            [InlineKeyboardButton(text="💰 Пополнить баланс", callback_data="admin:deposit")],
            [InlineKeyboardButton(text="💳 Заявки на пополнение", callback_data="admin:deposits")],
            [InlineKeyboardButton(text="💸 Заявки на вывод", callback_data="admin:withdrawals")],
            [InlineKeyboardButton(text="🎁 Создать промокод", callback_data="admin:promo")],
            [InlineKeyboardButton(text="📜 Список промокодов", callback_data="admin:promos")],
            [InlineKeyboardButton(text="🖼 Баннеры", callback_data="admin:banners")],
            [InlineKeyboardButton(text="🧾 Все операции", callback_data="admin:txs")],
        ]
    )


def admin_back_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="↩️ Назад", callback_data="admin:menu")]]
    )
