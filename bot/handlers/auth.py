"""Вход на сайт по одноразовому коду из Telegram.

Аккаунт на сайте — это тот же пользователь, что и в боте: Telegram ID,
баланс и очки общие (бот и сайт работают с одной SQLite-базой).
"""

import time

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

import config
from database import create_login_code, ensure_user, get_user
from keyboards import BTN_MY_ID, BTN_SITE, main_kb
from utils import esc, fmt

router = Router()

LOGIN_CODE_MINUTES = 15


def _site_kb(path: str = "/") -> InlineKeyboardMarkup | None:
    """Кнопка «Открыть сайт» — только если адрес реально доступен игроку."""
    url = (config.WEB_URL or "").rstrip("/")
    if not url.startswith(("http://", "https://")):
        return None
    host = url.split("//", 1)[-1].split("/", 1)[0].split(":", 1)[0].lower()
    if host in {"localhost", "127.0.0.1", "0.0.0.0"}:
        return None
    target = url + path
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="🌐 Открыть сайт", url=target)]]
    )


async def send_login_code(msg: Message) -> None:
    """Создаёт код и отправляет его игроку вместе с ID и балансом."""
    user = ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    code, expires_at = create_login_code(
        msg.from_user.id,
        msg.from_user.username,
        msg.from_user.first_name,
    )
    minutes = max(1, round((expires_at - time.time()) / 60))
    text = (
        f"🌐 <b>Вход на сайт</b>\n\n"
        f"Ваш код:\n<code>{code}</code>\n\n"
        f"<blockquote>"
        f"🆔 ID игрока: <code>{user['id']}</code>\n"
        f"💰 Баланс: <b>{fmt(user['balance'])}</b>\n"
        f"⭐ Очки: <b>{fmt(user['points'])}</b>\n"
        f"⏳ Код действует {minutes} мин и срабатывает один раз."
        f"</blockquote>\n\n"
        f"Введите код на сайте в разделе «🔐 Вход по ID из Telegram» — "
        f"сайт откроется под вашим аккаунтом и кошельком.\n\n"
        f"<i>Тот же ID — это ваш Telegram ID. Он же используется в базе и кошельке.</i>"
    )
    await msg.answer(text, reply_markup=_site_kb() or main_kb())


@router.message(Command("site"))
async def cmd_site(msg: Message, state: FSMContext):
    await state.clear()
    await send_login_code(msg)


async def send_admin_login_code(msg: Message, from_user=None) -> None:
    """Выдаёт код для входа в веб-админку. Только для ADMIN_IDS."""
    from handlers.admin import is_admin

    sender = from_user or msg.from_user

    if not config.ADMIN_PANEL_ENABLED:
        await msg.answer(
            "🛠 <b>Веб-админка отключена</b>\n\n"
            "<blockquote>ADMIN_PANEL_ENABLED=0 в .env. "
            "Управлять ботом можно командами /admin.</blockquote>"
        )
        return
    if not config.ADMIN_IDS:
        await msg.answer(
            "🛠 <b>Админка не настроена</b>\n\n"
            "Добавьте свой Telegram ID в <code>ADMIN_IDS</code> в .env и перезапустите бота."
        )
        return
    if not is_admin(sender.id):
        await msg.answer(
            "⛔ <b>Нет доступа</b>\n\n"
            "Веб-админка доступна только администраторам из <code>ADMIN_IDS</code>."
        )
        return

    user = ensure_user(sender.id, sender.username, sender.first_name)
    code, expires_at = create_login_code(
        sender.id,
        sender.username,
        sender.first_name,
        kind="admin",
    )
    minutes = max(1, round((expires_at - time.time()) / 60))
    site = (config.WEB_URL or "").rstrip("/")
    await msg.answer(
        f"🛠 <b>Вход в веб-админку</b>\n\n"
        f"Код:\n<code>{code}</code>\n\n"
        f"<blockquote>"
        f"🆔 Админ ID: <code>{user['id']}</code>\n"
        f"🌐 Страница: <code>{site}/admin</code>\n"
        f"⏳ Код действует {minutes} мин, срабатывает один раз.\n"
        f"🔒 Код подходит только для вашего Telegram ID."
        f"</blockquote>\n\n"
        f"Откройте сайт → «🛠 Админ» → введите код. Пароль не нужен.",
        reply_markup=_site_kb("/admin") or main_kb(),
    )


@router.message(F.text == BTN_SITE)
async def btn_site(msg: Message, state: FSMContext):
    await state.clear()
    await send_login_code(msg)


@router.message(Command("id"))
async def cmd_id(msg: Message, state: FSMContext):
    await state.clear()
    user = ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    username = f"@{esc(user.get('username'))}" if user.get("username") else "не задан"
    await msg.answer(
        f"🆔 <b>Ваш ID</b>\n\n"
        f"<blockquote>"
        f"Telegram ID: <code>{user['id']}</code>\n"
        f"Username: {username}\n"
        f"Имя: <b>{esc(user.get('first_name') or '—')}</b>\n"
        f"💰 Баланс: <b>{fmt(user['balance'])}</b>\n"
        f"⭐ Очки: <b>{fmt(user['points'])}</b>"
        f"</blockquote>\n\n"
        f"По этому ID вас находит админ в панели сайта, и он же привязан к кошельку."
    )


@router.message(F.text == BTN_MY_ID)
async def btn_my_id(msg: Message, state: FSMContext):
    await cmd_id(msg, state)
