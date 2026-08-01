import random
import string

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

import config
from database import (
    add_balance,
    create_promocode,
    find_user,
    get_all_promocodes,
    get_all_settings,
    get_all_transactions,
    get_pending_deposits,
    get_pending_withdrawals,
    get_stats,
    get_user,
    resolve_deposit,
    resolve_withdrawal,
    set_setting,
)
from keyboards import admin_back_kb, admin_kb
from services.rooms import room_manager
from utils import esc, fmt, fmt_ts, type_name

router = Router()


class AdminDeposit(StatesGroup):
    target = State()
    amount = State()


class AdminPromo(StatesGroup):
    code = State()
    amount = State()
    max_uses = State()


class AdminSetting(StatesGroup):
    key = State()
    value = State()


def is_admin(user_id: int) -> bool:
    return user_id in config.ADMIN_IDS


@router.message(Command("admin"))
async def admin_panel(msg: Message, state: FSMContext):
    await state.clear()
    if not is_admin(msg.from_user.id):
        await msg.answer("🚫 У вас нет доступа к админ-панели.")
        return
    await msg.answer("🛠 <b>Админ-панель</b>", reply_markup=admin_kb())


@router.callback_query(F.data == "admin:menu")
async def admin_menu_back(cb: CallbackQuery):
    if not is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    await cb.message.edit_text("🛠 <b>Админ-панель</b>", reply_markup=admin_kb())
    await cb.answer()


@router.callback_query(F.data == "admin:stats")
async def admin_stats(cb: CallbackQuery):
    if not is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    s = get_stats()
    waiting = sum(1 for r in room_manager.rooms.values() if r.status == "waiting")
    text = (
        f"📊 <b>Статистика</b>\n\n"
        f"<blockquote>👥 Пользователей: <b>{s['users']}</b>\n"
        f"💰 Общий баланс игроков: <b>{fmt(s['total_balance'])}</b>\n"
        f"💵 Пополнено админом: <b>{fmt(s['deposits'])}</b>\n"
        f"💸 Снято админом: <b>{fmt(s['withdrawals'])}</b>\n"
        f"🎁 Выдано промокодами: <b>{fmt(s['promo_total'])}</b>\n"
        f"🎲 Всего ставок: <b>{s['bets']}</b>\n"
        f"🏆 Выплат побед: <b>{s['wins']}</b>\n"
        f"🃏 Активных комнат: <b>{len(room_manager.rooms)}</b>\n"
        f"⏳ Ждут соперника: <b>{waiting}</b></blockquote>"
    )
    await cb.message.edit_text(text, reply_markup=admin_back_kb())
    await cb.answer()


# ---------- Настройки ----------

@router.callback_query(F.data == "admin:settings")
async def admin_settings(cb: CallbackQuery):
    if not is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    saved = get_all_settings()
    rows = []
    text = "⚙️ <b>Настройки</b>\n\nНажмите на параметр, чтобы изменить:\n"
    for key, (label, default) in config.SETTINGS.items():
        current = saved.get(key, getattr(config, key, None))
        if isinstance(default, str):
            display = fmt(current)
        else:
            display = fmt(int(current)) if str(current).lstrip("-").isdigit() else current
        text += f"\n• {label}: <b>{display}</b>"
        rows.append([InlineKeyboardButton(text=f"✏️ {label}", callback_data=f"admin:set:{key}")])
    rows.append([InlineKeyboardButton(text="↩️ Назад", callback_data="admin:menu")])
    await cb.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await cb.answer()


@router.callback_query(F.data.startswith("admin:set:"))
async def admin_set_start(cb: CallbackQuery, state: FSMContext):
    if not is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    key = cb.data.split(":", 2)[2]
    if key not in config.SETTINGS:
        await cb.answer("Неизвестный параметр", show_alert=True)
        return
    label, default = config.SETTINGS[key]
    await state.set_state(AdminSetting.value)
    await state.update_data(key=key)
    current = get_all_settings().get(key, getattr(config, key, default))
    if isinstance(default, str):
        hint = "Введите новое значение (текст):"
    else:
        hint = "Введите новое значение (целое число):"
    await cb.message.edit_text(
        f"⚙️ <b>{label}</b>\n\n"
        f"Текущее значение: <b>{fmt(current)}</b>\n"
        f"{hint}",
        reply_markup=admin_back_kb(),
    )
    await cb.answer()


@router.message(AdminSetting.value)
async def admin_set_value(msg: Message, state: FSMContext):
    text = (msg.text or "").strip()
    if not text:
        await msg.answer("Введите значение!")
        return
    data = await state.get_data()
    await state.clear()
    key = data["key"]
    label, default = config.SETTINGS[key]
    if isinstance(default, str):
        value = text
    else:
        if not text.lstrip("-").isdigit():
            await msg.answer("Введите целое число!")
            return
        value = int(text)
    set_setting(key, str(value))
    setattr(config, key, value)
    await msg.answer(
        f"✅ <b>{label}</b> = <b>{fmt(value)}</b>\n"
        f"Новое значение применяется сразу.",
        reply_markup=admin_back_kb(),
    )


# ---------- Заявки на пополнение ----------

@router.callback_query(F.data == "admin:deposits")
async def admin_deposits(cb: CallbackQuery):
    if not is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    pending = get_pending_deposits()
    if not pending:
        await cb.message.edit_text("💳 Заявок на пополнение нет.", reply_markup=admin_back_kb())
        await cb.answer()
        return
    await cb.answer()
    for d in pending[:20]:
        user = get_user(d["user_id"]) or {}
        name = f"@{esc(user['username'])}" if user.get("username") else f"<code>{d['user_id']}</code>"
        kb = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(text="✅ Зачислить", callback_data=f"admin:dep_ok:{d['id']}"),
                    InlineKeyboardButton(text="❌ Отклонить", callback_data=f"admin:dep_no:{d['id']}"),
                ]
            ]
        )
        await cb.message.answer(
            f"💳 <b>Заявка на пополнение #{d['id']}</b>\n"
            f"Пользователь: {name}\n"
            f"Сумма: <b>{fmt(d['amount'])}</b>\n"
            f"Дата: {fmt_ts(d['created_at'])}",
            reply_markup=kb,
        )


@router.callback_query(F.data.startswith("admin:dep_ok:"))
async def admin_dep_ok(cb: CallbackQuery):
    await _resolve_dep(cb, True, "✅ Средства зачислены игроку.")


@router.callback_query(F.data.startswith("admin:dep_no:"))
async def admin_dep_no(cb: CallbackQuery):
    await _resolve_dep(cb, False, "❌ Заявка отклонена.")


async def _resolve_dep(cb: CallbackQuery, approved: bool, ok_text: str) -> None:
    if not is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    d = resolve_deposit(int(cb.data.split(":")[2]), approved, cb.from_user.id)
    if not d:
        await cb.answer("Заявка уже обработана.", show_alert=True)
        return
    await cb.message.edit_text(ok_text)
    await cb.answer()
    try:
        user_text = (
            f"✅ Ваша заявка на пополнение #{d['id']} подтверждена!\n"
            f"На баланс зачислено: <b>{fmt(d['amount'])}</b>"
            if approved
            else f"❌ Ваша заявка на пополнение #{d['id']} отклонена."
        )
        await cb.bot.send_message(d["user_id"], user_text)
    except Exception:
        pass


# ---------- Пополнение / списание ----------

@router.callback_query(F.data == "admin:deposit")
async def admin_deposit_start(cb: CallbackQuery, state: FSMContext):
    if not is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    await state.set_state(AdminDeposit.target)
    await cb.message.edit_text(
        "Укажите ID пользователя или @username. "
        "Положительная сумма — пополнение, отрицательная — списание.",
        reply_markup=admin_back_kb(),
    )
    await cb.answer()


@router.message(AdminDeposit.target)
async def admin_deposit_target(msg: Message, state: FSMContext):
    user = find_user(msg.text)
    if not user:
        await msg.answer("❌ Пользователь не найден. Проверьте ID или @username.")
        return
    await state.update_data(target_id=user["id"])
    await state.set_state(AdminDeposit.amount)
    name = f"@{esc(user['username'])}" if user.get("username") else f"<code>{user['id']}</code>"
    await msg.answer(
        f"Пользователь: {name}, баланс: <b>{fmt(user['balance'])}</b>\n"
        f"Введите сумму:"
    )


@router.message(AdminDeposit.amount)
async def admin_deposit_amount(msg: Message, state: FSMContext):
    text = msg.text.strip()
    if not text.lstrip("-").isdigit() or text in ("-", ""):
        await msg.answer("Введите число (можно с минусом для списания).")
        return
    amount = int(text)
    data = await state.get_data()
    await state.clear()
    if amount >= 0:
        new_bal = add_balance(data["target_id"], amount, "deposit", "Пополнение баланса", admin_id=msg.from_user.id)
    else:
        new_bal = add_balance(data["target_id"], amount, "withdraw", "Списание баланса", admin_id=msg.from_user.id)
    user = get_user(data["target_id"])
    name = f"@{esc(user['username'])}" if user.get("username") else f"<code>{user['id']}</code>"
    await msg.answer(
        f"✅ Баланс игрока {name} изменён на <b>{amount:+}</b>.\n"
        f"Текущий баланс: <b>{fmt(new_bal)}</b>",
        reply_markup=admin_back_kb(),
    )


# ---------- Заявки на вывод ----------

@router.callback_query(F.data == "admin:withdrawals")
async def admin_withdrawals(cb: CallbackQuery):
    if not is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    pending = get_pending_withdrawals()
    if not pending:
        await cb.message.edit_text("💸 Заявок на вывод нет.", reply_markup=admin_back_kb())
        await cb.answer()
        return
    await cb.answer()
    for w in pending[:20]:
        user = get_user(w["user_id"]) or {}
        name = f"@{esc(user['username'])}" if user.get("username") else f"<code>{w['user_id']}</code>"
        kb = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(text="✅ Подтвердить", callback_data=f"admin:wd_ok:{w['id']}"),
                    InlineKeyboardButton(text="❌ Отклонить", callback_data=f"admin:wd_no:{w['id']}"),
                ]
            ]
        )
        await cb.message.answer(
            f"💸 <b>Заявка #{w['id']}</b>\n"
            f"Пользователь: {name}\n"
            f"Сумма: <b>{fmt(w['amount'])}</b>\n"
            f"Дата: {fmt_ts(w['created_at'])}",
            reply_markup=kb,
        )


async def _resolve_wd(cb: CallbackQuery, status: str, ok_text: str, user_text: str) -> None:
    if not is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    w = resolve_withdrawal(int(cb.data.split(":")[2]), status, cb.from_user.id)
    if not w:
        await cb.answer("Заявка уже обработана.", show_alert=True)
        return
    await cb.message.edit_text(ok_text)
    await cb.answer()
    try:
        await cb.bot.send_message(w["user_id"], user_text)
    except Exception:
        pass


@router.callback_query(F.data.startswith("admin:wd_ok:"))
async def admin_wd_ok(cb: CallbackQuery):
    await _resolve_wd(
        cb,
        "approved",
        "✅ Вывод подтверждён.",
        "✅ Ваша заявка на вывод подтверждена! Выплата в пути. 💎 Telegram Premium",
    )


@router.callback_query(F.data.startswith("admin:wd_no:"))
async def admin_wd_no(cb: CallbackQuery):
    await _resolve_wd(
        cb,
        "rejected",
        "❌ Вывод отклонён, средства возвращены.",
        "❌ Ваша заявка на вывод отклонена. Средства возвращены на баланс.",
    )


# ---------- Промокоды ----------

@router.callback_query(F.data == "admin:promo")
async def admin_promo_start(cb: CallbackQuery, state: FSMContext):
    if not is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    await state.set_state(AdminPromo.code)
    await cb.message.edit_text(
        "Введите промокод (или отправьте <b>«авто»</b> — сгенерируем случайный):",
        reply_markup=admin_back_kb(),
    )
    await cb.answer()


@router.message(AdminPromo.code)
async def admin_promo_code(msg: Message, state: FSMContext):
    code = msg.text.strip().upper()
    if not code or code.lower() == "авто":
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=8))
    await state.update_data(code=code)
    await state.set_state(AdminPromo.amount)
    await msg.answer(f"Промокод: <b>{code}</b>\nСумма пополнения:")


@router.message(AdminPromo.amount)
async def admin_promo_amount(msg: Message, state: FSMContext):
    text = msg.text.strip()
    if not text.isdigit():
        await msg.answer("Введите число!")
        return
    await state.update_data(amount=int(text))
    await state.set_state(AdminPromo.max_uses)
    await msg.answer("Максимум активаций:")


@router.message(AdminPromo.max_uses)
async def admin_promo_max_uses(msg: Message, state: FSMContext):
    text = msg.text.strip()
    if not text.isdigit():
        await msg.answer("Введите число!")
        return
    data = await state.get_data()
    await state.clear()
    ok = create_promocode(data["code"], data["amount"], int(text), msg.from_user.id)
    if ok:
        await msg.answer(
            f"✅ Промокод <b>{data['code']}</b> создан: +{fmt(data['amount'])} × {text} активаций\n\n"
            f"<code>https://t.me/c/{data['code']}</code>\n"
            f"↗️ Нажмите на ссылку — появится кнопка Copy (можно просто скопировать код)."
        )
    else:
        await msg.answer("❌ Такой промокод уже существует.")


@router.callback_query(F.data == "admin:promos")
async def admin_promos(cb: CallbackQuery):
    if not is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    pcs = get_all_promocodes()
    if not pcs:
        await cb.message.edit_text("Промокодов пока нет.", reply_markup=admin_back_kb())
        await cb.answer()
        return
    lines = [
        f"<b>{esc(p['code'])}</b> · +{fmt(p['amount'])} · активаций {p['used_count']}/{p['max_uses']}"
        for p in pcs
    ]
    await cb.message.edit_text("🎁 <b>Промокоды</b>\n" + "\n".join(lines), reply_markup=admin_back_kb())
    await cb.answer()


@router.callback_query(F.data == "admin:txs")
async def admin_txs(cb: CallbackQuery):
    if not is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    txs = get_all_transactions(30)
    if not txs:
        await cb.message.edit_text("Операций нет.", reply_markup=admin_back_kb())
        await cb.answer()
        return
    lines = []
    for t in txs:
        who = f"@{esc(t['username'])}" if t.get("username") else f"id{t['user_id']}"
        lines.append(
            f"#{t['id']} · {who} · {type_name(t['type'])} · <b>{t['amount']:+}</b> · {fmt_ts(t['created_at'])}"
        )
    text = "🧾 <b>Последние операции</b>\n" + "\n".join(lines)
    if len(text) > 3900:
        text = text[:3900] + "\n…"
    await cb.message.edit_text(text, reply_markup=admin_back_kb())
    await cb.answer()
