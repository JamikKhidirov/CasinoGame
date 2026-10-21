from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message

import config
from database import ensure_user, find_user, get_user, transfer
from keyboards import BTN_DONATE, BTN_TRANSFER, cancel_kb, main_kb
from utils import esc, fmt

router = Router()


class Transfer(StatesGroup):
    target = State()
    amount = State()


class Donate(StatesGroup):
    amount = State()


@router.message(Command("transfer"))
async def cmd_transfer(msg: Message, state: FSMContext):
    await transfer_start(msg, state)


@router.message(Command("donate"))
async def cmd_donate(msg: Message, state: FSMContext):
    await donate(msg, state)


@router.message(F.text == BTN_TRANSFER)
async def transfer_start(msg: Message, state: FSMContext):
    await state.clear()
    await state.set_state(Transfer.target)
    await msg.answer(
        "📤 <b>Перевод баланса</b>\nУкажите @username или ID получателя:",
        reply_markup=cancel_kb(),
    )

@router.message(Transfer.target)
async def transfer_target(msg: Message, state: FSMContext):
    user = find_user(msg.text)
    if not user:
        await msg.answer("❌ Пользователь не найден. Укажите @username или ID.")
        return
    if user["id"] == msg.from_user.id:
        await msg.answer("❌ Нельзя перевести средства самому себе.")
        return
    await state.update_data(target_id=user["id"])
    await state.set_state(Transfer.amount)
    name = f"@{esc(user['username'])}" if user.get("username") else f"<code>{user['id']}</code>"
    await msg.answer(f"Получатель: {name}\nСумма перевода:")


@router.message(Transfer.amount)
async def transfer_amount(msg: Message, state: FSMContext):
    text = (msg.text or "").strip()
    if not text.isdigit():
        await msg.answer("Введите сумму числом:")
        return
    amount = int(text)
    if amount <= 0:
        await msg.answer("Сумма должна быть больше нуля.")
        return
    data = await state.get_data()
    await state.clear()
    if transfer(msg.from_user.id, data["target_id"], amount):
        await msg.answer(
            f"✅ <b>Переведено!</b>\n\n<blockquote>Сумма: <b>{fmt(amount)}</b> 💰</blockquote>",
            reply_markup=main_kb(),
        )
    else:
        await msg.answer("❌ Недостаточно средств на балансе.", reply_markup=main_kb())


def _card_number_fmt(raw: str) -> str:
    """Номер карты группами по 4 цифры."""
    digits = "".join(ch for ch in raw if ch.isdigit())
    return " ".join(digits[i:i + 4] for i in range(0, len(digits), 4))


@router.message(F.text == BTN_DONATE)
async def donate(msg: Message, state: FSMContext):
    await state.clear()
    user = ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    await state.set_state(Donate.amount)
    text = (
        f"💝 <b>Донат проекту</b>\n\n"
        f"Поддержите развитие казино — переведите любую сумму на карту.\n"
        f"Ваш баланс: <b>{fmt(user['balance'])}</b> 💰\n\n"
        f"Введите сумму доната:"
    )
    await msg.answer(text, reply_markup=cancel_kb())


@router.message(Donate.amount)
async def donate_amount(msg: Message, state: FSMContext):
    text = (msg.text or "").strip()
    if not text.isdigit():
        await msg.answer("Введите сумму доната числом:")
        return
    amount = int(text)
    if amount <= 0:
        await msg.answer("Сумма должна быть больше нуля.")
        return
    await state.clear()

    card_type = config.DONATE_CARD_TYPE
    card_number = config.DONATE_CARD_NUMBER
    card_name = config.DONATE_CARD_NAME
    if not card_number:
        await msg.answer(
            "💝 <b>Донат</b>\n\n"
            "⚠️ Реквизиты для доната ещё не настроены администратором.\n"
            "Попробуйте позже.",
            reply_markup=main_kb(),
        )
        return

    user = get_user(msg.from_user.id)
    who = f"@{esc(user.get('username'))}" if user.get("username") else f"<code>{user['id']}</code>"
    number = _card_number_fmt(card_number)
    await msg.answer(
        f"💝 <b>Донат проекту</b>\n\n"
        f"<blockquote>🥰 Спасибо за поддержку!\n"
        f"Сумма доната: <b>{fmt(amount)}</b></blockquote>\n\n"
        f"Реквизиты для перевода:\n"
        f"🏦 Тип карты: <b>{esc(card_type or '—')}</b>\n"
        f"💳 Номер: <code>{esc(number)}</code>\n"
        f"👤 Получатель: <b>{esc(card_name or '—')}</b>\n\n"
        f"Переведите сумму вручную через любой банк или СБП. "
        f"После перевода напишите администратору — он отметит ваш донат.",
        reply_markup=main_kb(),
    )
    for admin_id in config.ADMIN_IDS:
        try:
            await msg.bot.send_message(
                admin_id,
                f"💝 <b>Новый донат</b>\n{who} хочет донатить <b>{fmt(amount)}</b>\n"
                f"Реквизиты: {esc(card_type or '')} · <code>{esc(number)}</code>",
            )
        except Exception:
            pass
