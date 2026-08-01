from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from database import ensure_user, get_top_points, get_top_users, get_transactions, get_user, get_user_stats
from keyboards import (
    BTN_BALANCE,
    BTN_HISTORY,
    BTN_STATS,
    BTN_TOP,
    main_kb,
)
from services.games import GAMES
from utils import esc, fmt, fmt_ts, type_name

router = Router()


def _top_text(kind: str, limit: int = 10) -> str:
    if kind == "points":
        rows = get_top_points(limit)
        return "🏆 <b>Топ игроков по очкам ⭐</b>\n\n<blockquote>" + "\n".join(
            f"{i + 1}. <b>@{esc(u['username'] or u['id'])}</b> — ⭐ {fmt(u['points'])}"
            for i, u in enumerate(rows)
        ) + "</blockquote>"
    rows = get_top_users(limit)
    return "🏆 <b>Топ игроков по балансу</b>\n\n<blockquote>" + "\n".join(
        f"{i + 1}. <b>@{esc(u['username'] or u['id'])}</b> — {fmt(u['balance'])}"
        for i, u in enumerate(rows)
    ) + "</blockquote>"


def _top_kb(kind: str) -> InlineKeyboardMarkup:
    if kind == "points":
        return InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton(text="💰 Топ по балансу", callback_data="top:balance")]]
        )
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="⭐ Топ по очкам", callback_data="top:points")]]
    )


@router.message(CommandStart())
async def cmd_start(msg: Message, state: FSMContext):
    await state.clear()
    ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    user = get_user(msg.from_user.id)
    games_line = " · ".join(f"{g['emoji']} {g['name']}" for g in GAMES.values())
    await msg.answer(
        f"🎰 <b>Добро пожаловать в Казино!</b>\n\n"
        f"Ваш баланс: <b>{fmt(user['balance'])}</b> 💰\n"
        f"Ваши очки (для бота): <b>{fmt(user['points'])}</b> ⭐\n\n"
        f"<blockquote>🎮 <b>Наши игры:</b>\n{games_line}</blockquote>\n\n"
        f"🤖 <b>Играть с ботом</b> — бесплатно на очках ⭐ прямо в личке\n"
        f"🎮 <b>Создать комнату</b> — игра 1 на 1 с друзьями (лучше в группе)\n"
        f"🔄 <b>Обмен очков</b> — ⭐ ↔ 💰 по выгодному курсу\n"
        f"📊 Моя статистика и топ игроков\n"
        f"💸 Вывод средств (Telegram Premium) и переводы\n"
        f"💝 Донат и 🎁 промокоды",
        reply_markup=main_kb(),
    )


@router.message(Command("help"))
async def cmd_help(msg: Message, state: FSMContext):
    await state.clear()
    await msg.answer(
        f"❓ <b>Помощь</b>\n\n"
        f"🎮 <b>Создать комнату</b> — выберите игру, укажите ставку. Комната живёт 15 сек, "
        f"вступить можно кнопкой или ответом на сообщение комнаты.\n\n"
        f"🤖 <b>Играть с ботом</b> — быстрая игра против бота в личке на бесплатных очках ⭐ "
        f"(их выдаём каждому новичку).\n\n"
        f"<blockquote>🎲 <b>Как ходить:</b> отправьте эмодзи игры (например 🎲) или нажмите "
        f"кнопку «Бросить». Если не ходите 30 сек — бот сделает ход за вас.</blockquote>\n\n"
        f"🔄 <b>Обмен очков</b> — /convert: конвертируйте 💰 в ⭐ по выгодному курсу "
        f"(1 💰 = 1.5 ⭐) или обратно.\n\n"
        f"💸 <b>Вывод</b> — накопите минимум и запросите вывод. Выплаты: Telegram Premium.\n\n"
        f"💳 <b>Пополнение</b> — /deposit: оставьте заявку на пополнение, админ подтвердит.\n\n"
        f"📤 <b>Перевод</b> — отправляйте баланс друзьям.\n\n"
        f"🏆 <b>Топы</b> — /top (баланс) и /topbot (очки ⭐).\n\n"
        f"🎁 <b>Промокод</b> — активируйте бонусы через /promo.",
        reply_markup=main_kb(),
    )


@router.message(Command("balance"))
async def cmd_balance(msg: Message, state: FSMContext):
    await balance(msg, state)


@router.message(Command("history"))
async def cmd_history(msg: Message, state: FSMContext):
    await history(msg, state)


@router.message(Command("stats"))
async def cmd_stats(msg: Message, state: FSMContext):
    await my_stats(msg, state)


@router.message(Command("top"))
async def cmd_top(msg: Message, state: FSMContext):
    await top(msg, state)


@router.message(F.text == BTN_BALANCE)
async def balance(msg: Message, state: FSMContext):
    await state.clear()
    ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    user = get_user(msg.from_user.id)
    await msg.answer(
        f"💰 <b>Ваш баланс</b>\n\n"
        f"<blockquote>Баланс: <b>{fmt(user['balance'])}</b> 💰\n"
        f"Очки для бота: <b>{fmt(user['points'])}</b> ⭐</blockquote>"
    )


@router.message(F.text == BTN_HISTORY)
async def history(msg: Message, state: FSMContext):
    await state.clear()
    ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    txs = get_transactions(msg.from_user.id, 15)
    if not txs:
        await msg.answer("Пока нет операций.")
        return
    lines = [
        f"{fmt_ts(t['created_at'])} · {type_name(t['type'])} · <b>{t['amount']:+}</b>"
        for t in txs
    ]
    await msg.answer("🧾 <b>История операций</b>\n\n<blockquote>" + "\n".join(lines) + "</blockquote>")


@router.message(F.text == BTN_STATS)
async def my_stats(msg: Message, state: FSMContext):
    await state.clear()
    ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    s = get_user_stats(msg.from_user.id)
    if s["total"] == 0:
        await msg.answer("📊 Вы ещё не сыграли ни одной игры. Заходите в «Создать комнату»!")
        return
    win_rate = s["wins"] / s["total"] * 100 if s["total"] else 0
    fav = GAMES.get(s["favorite"]["game_key"], {}).get("name", s["favorite"]["game_key"]) if s["favorite"] else "—"
    text = (
        f"📊 <b>Ваша статистика</b>\n\n"
        f"<blockquote>🎮 Игр сыграно: <b>{s['total']}</b>\n"
        f"🏆 Побед: <b>{s['wins']}</b> ({win_rate:.0f}%)\n"
        f"💀 Поражений: <b>{s['losses']}</b>\n"
        f"🤝 Ничьих: <b>{s['ties']}</b>\n"
        f"💰 Выиграно всего: <b>+{fmt(s['total_won'])}</b>\n"
        f"💸 Проиграно всего: <b>{fmt(s['total_lost'])}</b>\n"
        f"📈 Итог: <b>{s['net']:+}</b>\n"
        f"❤️ Любимая игра: <b>{fav}</b> ({s['favorite']['cnt']} игр)</blockquote>"
    )
    if s["by_game"]:
        breakdown = "\n".join(
            f"{GAMES.get(g['game_key'], {}).get('emoji', '🎮')} {GAMES.get(g['game_key'], {}).get('name', g['game_key'])} — {g['cnt']}"
            for g in s["by_game"]
        )
        text += f"\n\n<b>По играм:</b>\n{breakdown}"
    await msg.answer(text)


@router.message(F.text == BTN_TOP)
async def top(msg: Message, state: FSMContext):
    await state.clear()
    ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    await msg.answer(_top_text("balance"), reply_markup=_top_kb("balance"))


@router.message(Command("topbot"))
async def top_points(msg: Message, state: FSMContext):
    await state.clear()
    ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    await msg.answer(_top_text("points"), reply_markup=_top_kb("points"))


@router.callback_query(F.data.startswith("top:"))
async def top_cb(cb: CallbackQuery):
    kind = cb.data.split(":")[1]
    if kind not in ("balance", "points"):
        await cb.answer("Неизвестный топ", show_alert=True)
        return
    try:
        await cb.message.edit_text(_top_text(kind), reply_markup=_top_kb(kind))
    except Exception:
        pass
    await cb.answer()
