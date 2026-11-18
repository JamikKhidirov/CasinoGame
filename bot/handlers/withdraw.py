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

METHODS = {
    "card": "💳 Карта",
    "account": "🏦 Счёт",
}


class Withdraw(StatesGroup):
    amount = State()
    requisites = State()
    holder = State()
    bank = State()


def _method_by_target(target: str) -> str:
    """16–19 цифр — карта, всё остальное — банковский счёт."""
    return "card" if target.isdigit() and 16 <= len(target) <= 19 else "account"


def _clean_target(raw: str) -> str:
    return "".join(ch for ch in str(raw or "") if ch.isalnum())


def _validate_target(target: str) -> str | None:
    if not target:
        return "Введите номер карты или счёта."
    if target.isdigit():
        if 16 <= len(target) <= 19:
            return None
        return "Номер карты должен содержать 16–19 цифр."
    if 6 <= len(target) <= 34:
        return None
    return "Номер счёта должен содержать 6–34 буквы или цифры."


def _requisites_text(method: str, target: str, holder: str, bank: str) -> str:
    lines = [
        f"Способ: <b>{METHODS.get(method, method)}</b>",
        f"Реквизиты: <code>{esc(target)}</code>",
        f"Получатель: <b>{esc(holder)}</b>",
    ]
    if bank:
        lines.append(f"Банк: <b>{esc(bank)}</b>")
    return "\n".join(lines)


@router.message(Command("withdraw"))
async def cmd_withdraw(msg: Message, state: FSMContext):
    await withdraw_start(msg, state)


@router.message(F.text == BTN_WITHDRAW)
async def withdraw_start(msg: Message, state: FSMContext):
    await state.clear()
    if not config.payments_enabled():
        await msg.answer(config.FUN_MODE_MESSAGE, reply_markup=main_kb())
        return
    user = get_user(msg.from_user.id)
    bal = user["balance"] if user else 0
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
        f"ℹ️ {esc(config.WITHDRAW_NOTE)}</blockquote>\n\n"
        f"Укажите сумму вывода (средства заморозятся до решения админа):",
        reply_markup=cancel_kb(),
    )


@router.message(Withdraw.amount)
async def withdraw_amount(msg: Message, state: FSMContext):
    text = (msg.text or "").strip().replace(" ", "")
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
    await state.update_data(amount=amount)
    await state.set_state(Withdraw.requisites)
    await msg.answer(
        f"<b>{fmt(amount)}</b> 💰 будет заморожено после заявки.\n\n"
        f"💳 Введите <b>номер карты</b> (16–19 цифр) или "
        f"<b>номер банковского счёта</b> (20 цифр / номер по договору):",
        reply_markup=cancel_kb(),
    )


@router.message(Withdraw.requisites)
async def withdraw_requisites(msg: Message, state: FSMContext):
    target = _clean_target(msg.text)
    error = _validate_target(target)
    if error:
        await msg.answer(error)
        return
    await state.update_data(target=target, method=_method_by_target(target))
    await state.set_state(Withdraw.holder)
    await msg.answer(
        "👤 Введите <b>имя получателя</b> (как в банке):",
        reply_markup=cancel_kb(),
    )


@router.message(Withdraw.holder)
async def withdraw_holder(msg: Message, state: FSMContext):
    holder = " ".join((msg.text or "").replace("<", "").replace(">", "").split()).strip()
    if len(holder) < 2:
        await msg.answer("Введите имя получателя (минимум 2 символа):")
        return
    await state.update_data(holder=holder[:80])
    await state.set_state(Withdraw.bank)
    await msg.answer(
        "🏦 Укажите банк (необязательно).\n"
        "Отправьте название банка или <code>-</code>, чтобы пропустить:",
        reply_markup=cancel_kb(),
    )


@router.message(Withdraw.bank)
async def withdraw_bank(msg: Message, state: FSMContext):
    data = await state.get_data()
    bank = (msg.text or "").replace("<", "").replace(">", "").strip()
    if bank in {"-", "—", "нет", "пропустить"}:
        bank = ""
    bank = bank[:80]

    if not config.payments_enabled():
        await state.clear()
        await msg.answer(config.FUN_MODE_MESSAGE, reply_markup=main_kb())
        return

    amount = int(data["amount"])
    target = data["target"]
    holder = data["holder"]
    method = data.get("method", "card")
    user = get_user(msg.from_user.id)
    if not user or user["balance"] < amount:
        await state.clear()
        await msg.answer("❌ Недостаточно средств на балансе.", reply_markup=main_kb())
        return

    wid = create_withdrawal(
        msg.from_user.id,
        amount,
        payout_method=method,
        payout_target=target,
        payout_name=holder,
        payout_bank=bank,
        source="bot",
    )
    change_balance(msg.from_user.id, -amount, "hold", f"Заявка на вывод #{wid}")
    await state.clear()

    requisites = _requisites_text(method, target, holder, bank)
    name = f"@{esc(user.get('username'))}" if user.get("username") else f"<code>{user['id']}</code>"
    for admin_id in config.ADMIN_IDS:
        try:
            await msg.bot.send_message(
                admin_id,
                f"💸 <b>Новая заявка на вывод</b>\n"
                f"#{wid} · {name} · <b>{fmt(amount)}</b> 💰\n"
                f"{requisites}\n\n"
                f"Откройте /admin → «Заявки на вывод»",
            )
        except Exception:
            pass

    await msg.answer(
        f"✅ <b>Заявка на вывод #{wid} создана!</b>\n\n"
        f"<blockquote>Сумма: <b>{fmt(amount)}</b> 💰\n"
        f"{requisites}</blockquote>\n\n"
        f"Средства заморожены до решения администратора. "
        f"Выплата придёт на указанные реквизиты.",
        reply_markup=main_kb(),
    )
