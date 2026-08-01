from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

import config
from database import change_balance, change_points, ensure_user, get_user
from keyboards import BTN_CONVERT, cancel_kb
from utils import fmt

router = Router()


class Convert(StatesGroup):
    amount = State()


def _rates_text() -> str:
    buy = config.POINTS_BUY_RATE / 100
    sell = config.POINTS_SELL_RATE / 100
    return (
        f"🔄 <b>Обмен валют</b>\n\n"
        f"<blockquote>💰 Баланс → ⭐ Очки: <b>1 💰 = {buy:g} ⭐</b> (выгодно!)\n"
        f"⭐ Очки → 💰 Баланс: <b>1 ⭐ = {sell:g} 💰</b></blockquote>\n\n"
        f"⭐ Очки — бесплатная валюта для игр с ботом. "
        f"Сейчас это лучший способ получить бонус к ставкам."
    )


def _convert_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="💰 → ⭐ Купить очки", callback_data="convert:buy")],
            [InlineKeyboardButton(text="⭐ → 💰 Продать очки", callback_data="convert:sell")],
            [InlineKeyboardButton(text="🚫 Отмена", callback_data="cancel")],
        ]
    )


@router.message(Command("convert"))
async def cmd_convert(msg: Message, state: FSMContext):
    await convert_menu(msg, state)


@router.message(F.text == BTN_CONVERT)
async def convert_menu(msg: Message, state: FSMContext):
    await state.clear()
    ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    user = get_user(msg.from_user.id)
    await msg.answer(
        _rates_text()
        + f"\n\nВаш баланс: <b>{fmt(user['balance'])}</b> 💰 | Очки: <b>{fmt(user['points'])}</b> ⭐",
        reply_markup=_convert_kb(),
    )


@router.callback_query(F.data.startswith("convert:"))
async def convert_dir(cb: CallbackQuery, state: FSMContext):
    direction = cb.data.split(":")[1]
    if direction not in ("buy", "sell"):
        await cb.answer("Неизвестное направление", show_alert=True)
        return
    await state.update_data(direction=direction)
    await state.set_state(Convert.amount)
    hint = (
        "Введите сумму в 💰, которую хотите обменять на очки ⭐:"
        if direction == "buy"
        else "Введите количество очков ⭐, которые хотите обменять на 💰:"
    )
    await cb.message.edit_text(hint, reply_markup=cancel_kb())
    await cb.answer()


@router.message(Convert.amount)
async def convert_amount(msg: Message, state: FSMContext):
    text = (msg.text or "").strip()
    if not text.isdigit():
        await msg.answer("Введите сумму числом:")
        return
    amount = int(text)
    if amount <= 0:
        await msg.answer("Сумма должна быть больше нуля.")
        return
    data = await state.get_data()
    direction = data.get("direction")
    if direction not in ("buy", "sell"):
        await msg.answer("Что-то пошло не так — начните заново.")
        return
    user = get_user(msg.from_user.id)

    if direction == "buy":
        if amount > user["balance"]:
            await msg.answer("❌ Недостаточно средств на балансе.")
            return
        points = amount * config.POINTS_BUY_RATE // 100
        if points < 1:
            await msg.answer("Слишком маленькая сумма — вы получите 0 очков.")
            return
        await state.clear()
        change_balance(msg.from_user.id, -amount, "convert", "Обмен на очки (💰 → ⭐)")
        change_points(msg.from_user.id, points, "convert", "Обмен из баланса (💰 → ⭐)")
        await msg.answer(
            f"✅ <b>Обмен выполнен!</b>\n\n"
            f"<blockquote><b>-{fmt(amount)}</b> 💰 → <b>+{fmt(points)}</b> ⭐</blockquote>\n"
            f"Ваши очки: <b>{fmt(user['points'] + points)}</b> ⭐"
        )
    else:
        if amount > user["points"]:
            await msg.answer("❌ Недостаточно очков ⭐ на счету.")
            return
        balance = amount * config.POINTS_SELL_RATE // 100
        if balance < 1:
            await msg.answer("Слишком мало очков — вы получите 0 💰.")
            return
        await state.clear()
        change_points(msg.from_user.id, -amount, "convert", "Обмен на баланс (⭐ → 💰)")
        change_balance(msg.from_user.id, balance, "convert", "Обмен из очков (⭐ → 💰)")
        await msg.answer(
            f"✅ <b>Обмен выполнен!</b>\n\n"
            f"<blockquote><b>-{fmt(amount)}</b> ⭐ → <b>+{fmt(balance)}</b> 💰</blockquote>\n"
            f"Ваш баланс: <b>{fmt(user['balance'] + balance)}</b> 💰"
        )
