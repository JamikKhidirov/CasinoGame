from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

import config
from database import (
    create_banner,
    delete_banner,
    get_all_banners,
    get_banner,
    set_banner_enabled,
)
from keyboards import admin_back_kb, cancel_kb
from services.banners import broadcast_banner
from utils import esc, fmt

router = Router()


class AdminBanner(StatesGroup):
    name = State()
    title = State()
    text = State()
    photo = State()
    button_text = State()
    button_url = State()
    interval = State()


def _is_admin(user_id: int) -> bool:
    return user_id in config.ADMIN_IDS


# ---------- список баннеров ----------

@router.callback_query(F.data == "admin:banners")
async def admin_banners_list(cb: CallbackQuery):
    if not _is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    banners = get_all_banners()
    rows = [[InlineKeyboardButton(text="➕ Создать баннер", callback_data="admin:banner_create")]]
    for b in banners:
        icon = "✅" if b["enabled"] else "⏸"
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"{icon} {b['name']} (инт {b['interval_minutes']} мин)",
                    callback_data=f"admin:banner_send:{b['id']}",
                )
            ]
        )
        rows.append(
            [
                InlineKeyboardButton(text="📨 Отправить", callback_data=f"admin:banner_send:{b['id']}"),
                InlineKeyboardButton(text="⏯ Вкл/Выкл", callback_data=f"admin:banner_toggle:{b['id']}"),
                InlineKeyboardButton(text="🗑 Удалить", callback_data=f"admin:banner_del:{b['id']}"),
            ]
        )
    rows.append([InlineKeyboardButton(text="↩️ Назад", callback_data="admin:menu")])
    text = (
        f"🖼 <b>Баннеры</b> — всего {len(banners)}\n\n"
        f"Кнопка с названием показывает превью баннера.\n"
        f"«Отправить» — рассылка всем, кто ещё не получал.\n"
        f"«Вкл/Выкл» — авто-рассылка по интервалу."
    )
    await cb.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await cb.answer()


@router.callback_query(F.data.startswith("admin:banner_send:"))
async def admin_banner_send(cb: CallbackQuery):
    if not _is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    banner = get_banner(int(cb.data.split(":")[2]))
    if not banner:
        await cb.answer("Баннер не найден", show_alert=True)
        return
    await cb.answer("Начинаю рассылку...")
    sent, failed = await broadcast_banner(cb.bot, banner)
    await cb.message.answer(
        f"📨 Рассылка баннера <b>{esc(banner['name'])}</b> завершена.\n"
        f"Отправлено: <b>{sent}</b>\nОшибок/пропущено: <b>{failed}</b>",
        reply_markup=admin_back_kb(),
    )


@router.callback_query(F.data.startswith("admin:banner_toggle:"))
async def admin_banner_toggle(cb: CallbackQuery):
    if not _is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    banner = get_banner(int(cb.data.split(":")[2]))
    if not banner:
        await cb.answer("Баннер не найден", show_alert=True)
        return
    set_banner_enabled(banner["id"], not banner["enabled"])
    await cb.answer()
    await admin_banners_list(cb)


@router.callback_query(F.data.startswith("admin:banner_del:"))
async def admin_banner_del(cb: CallbackQuery):
    if not _is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    delete_banner(int(cb.data.split(":")[2]))
    await cb.answer("Баннер удалён.")
    await cb.message.edit_text("Баннер удалён.", reply_markup=admin_back_kb())


# ---------- создание баннера ----------

@router.callback_query(F.data == "admin:banner_create")
async def admin_banner_create(cb: CallbackQuery, state: FSMContext):
    if not _is_admin(cb.from_user.id):
        await cb.answer("Нет доступа", show_alert=True)
        return
    await state.set_state(AdminBanner.name)
    await cb.message.edit_text(
        "🖼 <b>Создание баннера</b> — шаг 1/7\n\nВведите название (видно только админу):",
        reply_markup=cancel_kb(),
    )
    await cb.answer()


@router.message(AdminBanner.name)
async def admin_banner_name(msg: Message, state: FSMContext):
    await state.update_data(name=msg.text.strip())
    await state.set_state(AdminBanner.title)
    await msg.answer("Шаг 2/7 — Заголовок (покажется в посте):", reply_markup=cancel_kb())


@router.message(AdminBanner.title)
async def admin_banner_title(msg: Message, state: FSMContext):
    await state.update_data(title=msg.text.strip())
    await state.set_state(AdminBanner.text)
    await msg.answer("Шаг 3/7 — Текст/описание (можно HTML-разметку):", reply_markup=cancel_kb())


@router.message(AdminBanner.text)
async def admin_banner_text(msg: Message, state: FSMContext):
    await state.update_data(text=msg.text.strip())
    await state.set_state(AdminBanner.photo)
    await msg.answer("Шаг 4/7 — Пришлите фото (или отправьте «нет»):", reply_markup=cancel_kb())


@router.message(AdminBanner.photo)
async def admin_banner_photo(msg: Message, state: FSMContext):
    if msg.photo:
        photo = msg.photo[-1].file_id
    elif (msg.text or "").strip().lower() in ("нет", "no", "-"):
        photo = None
    else:
        await msg.answer("Пришлите фото или отправьте «нет»:")
        return
    await state.update_data(photo=photo)
    await state.set_state(AdminBanner.button_text)
    await msg.answer("Шаг 5/7 — Текст кнопки (например «Играть»):", reply_markup=cancel_kb())


@router.message(AdminBanner.button_text)
async def admin_banner_button_text(msg: Message, state: FSMContext):
    await state.update_data(button_text=msg.text.strip())
    await state.set_state(AdminBanner.button_url)
    await msg.answer("Шаг 6/7 — Ссылка кнопки (URL):", reply_markup=cancel_kb())


@router.message(AdminBanner.button_url)
async def admin_banner_button_url(msg: Message, state: FSMContext):
    await state.update_data(button_url=msg.text.strip())
    await state.set_state(AdminBanner.interval)
    await msg.answer(
        f"Шаг 7/7 — Интервал авто-рассылки в минутах\n"
        f"(0 — только вручную; пример: 30):",
        reply_markup=cancel_kb(),
    )


@router.message(AdminBanner.interval)
async def admin_banner_interval(msg: Message, state: FSMContext):
    text = (msg.text or "").strip()
    if not text.isdigit():
        await msg.answer("Введите число минут (0 — только вручную):")
        return
    data = await state.get_data()
    await state.clear()
    bid = create_banner(
        data["name"],
        data.get("title"),
        data.get("text"),
        data.get("photo"),
        data.get("button_text"),
        data.get("button_url"),
        int(text),
    )
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="📨 Отправить сейчас", callback_data=f"admin:banner_send:{bid}")],
            [InlineKeyboardButton(text="↩️ Назад", callback_data="admin:menu")],
        ]
    )
    interval_note = f"Авто-рассылка: каждые {text} мин." if int(text) > 0 else "Авто-рассылка: выключена."
    await msg.answer(
        f"✅ Баннер <b>{esc(data['name'])}</b> создан! (id {bid})\n"
        f"Интервал: {fmt(int(text))} мин.\n{interval_note}",
        reply_markup=kb,
    )
