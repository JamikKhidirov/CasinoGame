from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

import config
from database import create_deposit, ensure_user, get_user
from keyboards import BTN_DEPOSIT, cancel_kb, main_kb
from utils import esc, fmt

router = Router()

DEPOSIT_MIN = 1


class Deposit(StatesGroup):
    amount = State()


@router.message(Command("deposit"))
async def cmd_deposit(msg: Message, state: FSMContext):
    await deposit_start(msg, state)


@router.message(F.text == BTN_DEPOSIT)
async def deposit_start(msg: Message, state: FSMContext):
    await state.clear()
    ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    await state.set_state(Deposit.amount)
    await msg.answer(
        f"💳 <b>Пополнение счёта</b>\n\n"
        f"Укажите сумму, которую хотите внести (минимум {fmt(DEPOSIT_MIN)}).\n"
        f"Заявка уйдёт администратору — после подтверждения средства зачислятся на баланс.\n\n"
        f"<blockquote>Ваш баланс: <b>{fmt(get_user(msg.from_user.id)['balance'])}</b> 💰</blockquote>",
        reply_markup=cancel_kb(),
    )


@router.message(Deposit.amount)
async def deposit_amount(msg: Message, state: FSMContext):
    text = (msg.text or "").strip()
    if not text.isdigit():
        await msg.answer("Введите сумму числом:")
        return
    amount = int(text)
    if amount < DEPOSIT_MIN:
        await msg.answer(f"Минимальная сумма пополнения: <b>{fmt(DEPOSIT_MIN)}</b>")
        return
    user = ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    did = create_deposit(msg.from_user.id, amount)
    await state.clear()

    name = f"@{esc(user.get('username'))}" if user.get("username") else f"<code>{user['id']}</code>"
    for admin_id in config.ADMIN_IDS:
        try:
            await msg.bot.send_message(
                admin_id,
                f"💳 <b>Новая заявка на пополнение</b>\n"
                f"#{did} · {name} · <b>{fmt(amount)}</b>\n"
                f"Откройте /admin → «Заявки на пополнение»",
                reply_markup=InlineKeyboardMarkup(
                    inline_keyboard=[
                        [
                            InlineKeyboardButton(text="✅ Зачислить", callback_data=f"admin:dep_ok:{did}"),
                            InlineKeyboardButton(text="❌ Отклонить", callback_data=f"admin:dep_no:{did}"),
                        ]
                    ]
                ),
            )
        except Exception:
            pass

    await msg.answer(
        f"✅ <b>Заявка на пополнение #{did} создана!</b>\n\n"
        f"<blockquote>Сумма: <b>{fmt(amount)}</b></blockquote>\n"
        f"Как только администратор подтвердит — средства появятся на балансе.",
        reply_markup=main_kb(),
    )
