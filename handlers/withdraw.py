from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message

import config
from database import change_balance, create_withdrawal, get_user
from keyboards import BTN_WITHDRAW, cancel_kb, main_kb
from utils import esc, fmt

router = Router()


class Withdraw(StatesGroup):
    amount = State()


@router.message(Command("withdraw"))
async def cmd_withdraw(msg: Message, state: FSMContext):
    await withdraw_start(msg, state)


@router.message(F.text == BTN_WITHDRAW)
async def withdraw_start(msg: Message, state: FSMContext):
    await state.clear()
    user = get_user(msg.from_user.id)
    bal = user["balance"]
    if bal < config.WITHDRAW_MIN:
        await msg.answer(
            f"💸 <b>Вывод средств</b>\n\n"
            f"<blockquote>Минимальная сумма вывода: <b>{fmt(config.WITHDRAW_MIN)}</b>\n"
            f"Ваш баланс: <b>{fmt(bal)}</b></blockquote>\n\n"
            f"Играйте и накопите нужную сумму!",
            reply_markup=main_kb(),
        )
        return
    await state.set_state(Withdraw.amount)
    await msg.answer(
        f"💸 <b>Вывод средств</b>\n\n"
        f"<blockquote>Ваш баланс: <b>{fmt(bal)}</b>\n"
        f"Минимум: <b>{fmt(config.WITHDRAW_MIN)}</b>\n"
        f"💎 {config.WITHDRAW_NOTE}</blockquote>\n\n"
        f"Укажите сумму вывода (средства заморозятся до решения админа):",
        reply_markup=cancel_kb(),
    )


@router.message(Withdraw.amount)
async def withdraw_amount(msg: Message, state: FSMContext):
    text = (msg.text or "").strip()
    if not text.isdigit():
        await msg.answer("Введите сумму числом:")
        return
    amount = int(text)
    user = get_user(msg.from_user.id)
    if amount < config.WITHDRAW_MIN:
        await msg.answer(f"Минимальная сумма вывода: <b>{fmt(config.WITHDRAW_MIN)}</b>")
        return
    if amount > user["balance"]:
        await msg.answer("❌ Недостаточно средств на балансе.")
        return
    wid = create_withdrawal(msg.from_user.id, amount)
    change_balance(msg.from_user.id, -amount, "hold", f"Заявка на вывод #{wid}")
    await state.clear()

    name = f"@{esc(user.get('username'))}" if user.get("username") else f"<code>{user['id']}</code>"
    for admin_id in config.ADMIN_IDS:
        try:
            await msg.bot.send_message(
                admin_id,
                f"💸 <b>Новая заявка на вывод</b>\n"
                f"#{wid} · {name} · <b>{fmt(amount)}</b>\n"
                f"Откройте /admin → «Заявки на вывод»",
            )
        except Exception:
            pass

    await msg.answer(
        f"✅ <b>Заявка на вывод #{wid} создана!</b>\n\n"
        f"<blockquote>Сумма: <b>{fmt(amount)}</b>\n"
        f"💎 {config.WITHDRAW_NOTE}</blockquote>\n\n"
        f"Средства заморожены до решения администратора.",
        reply_markup=main_kb(),
    )
