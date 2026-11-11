"""Рассылка рекламных баннеров всем пользователям.

Каждый пользователь получает конкретный баннер максимум один раз
(таблица banner_sends), поэтому авторассылка не дублирует посты.
"""

import asyncio
import logging
import time

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from database import (
    get_all_user_ids,
    mark_banner_sent,
    record_banner_send,
    user_received_banner,
)
from utils import esc

logger = logging.getLogger(__name__)

# защита от одновременной рассылки одного и того же баннера
_sending: set[int] = set()


def banner_kb(banner: dict) -> InlineKeyboardMarkup | None:
    if banner.get("button_text") and banner.get("button_url"):
        return InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text=banner["button_text"], url=banner["button_url"])]
            ]
        )
    return None


def banner_text(banner: dict) -> str:
    parts = []
    if banner.get("title"):
        parts.append(f"<b>{esc(banner['title'])}</b>")
    if banner.get("text"):
        parts.append(banner["text"])
    return "\n\n".join(parts)


async def send_banner_to_user(bot, user_id: int, banner: dict) -> None:
    kb = banner_kb(banner)
    text = banner_text(banner)
    if banner.get("photo"):
        await bot.send_photo(user_id, banner["photo"], caption=text, reply_markup=kb)
    else:
        await bot.send_message(user_id, text, reply_markup=kb, disable_web_page_preview=True)


async def broadcast_banner(bot, banner: dict) -> tuple[int, int]:
    """Рассылает баннер всем, кто его ещё не получал. Возвращает (отправлено, ошибок)."""
    bid = banner["id"]
    if bid in _sending:
        return 0, 0
    _sending.add(bid)
    sent, failed = 0, 0
    try:
        for uid in get_all_user_ids():
            if user_received_banner(bid, uid):
                continue
            try:
                await send_banner_to_user(bot, uid, banner)
                record_banner_send(bid, uid)
                sent += 1
            except Exception as e:
                failed += 1
                logger.warning("Рассылка баннера %s юзеру %s не удалась: %s", bid, uid, e)
            await asyncio.sleep(0.033)  # не упираемся в лимиты Telegram
    finally:
        _sending.discard(bid)
    mark_banner_sent(bid, int(time.time()))
    return sent, failed
