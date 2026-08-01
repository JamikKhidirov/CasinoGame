import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand, BotCommandScopeChat

import config
from database import get_due_banners, init_db
from handlers import admin, banner, common, convert, deposit, promo, rooms, start, transfer, withdraw
from services.banners import broadcast_banner
from services.rooms import bot_room_manager, room_manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# Команды для всех пользователей (появляются в меню автоматически)
USER_COMMANDS = [
    BotCommand(command="start", description="🏠 Главное меню"),
    BotCommand(command="games", description="🎮 Создать комнату"),
    BotCommand(command="bot", description="🤖 Играть с ботом"),
    BotCommand(command="balance", description="💰 Баланс"),
    BotCommand(command="history", description="📜 История операций"),
    BotCommand(command="stats", description="📊 Моя статистика"),
    BotCommand(command="top", description="🏆 Топ по балансу"),
    BotCommand(command="topbot", description="⭐ Топ по очкам бота"),
    BotCommand(command="convert", description="🔄 Обмен очков ⭐ ↔ 💰"),
    BotCommand(command="withdraw", description="💸 Вывод средств"),
    BotCommand(command="deposit", description="💳 Пополнить счёт"),
    BotCommand(command="transfer", description="📤 Перевод баланса"),
    BotCommand(command="donate", description="💝 Донат"),
    BotCommand(command="promo", description="🎁 Промокод"),
    BotCommand(command="help", description="❓ Помощь"),
]

# Команды только для админов (видит только админ)
ADMIN_COMMANDS = [
    BotCommand(command="admin", description="🛠 Админ-панель"),
]


async def setup_commands(bot: Bot) -> None:
    """Автоматически прописывает команды в меню:
    обычные пользователи видят все команды, кроме /admin и админских.
    Админы дополнительно видят админ-команды.
    В BotFather ничего вручную не нужно."""
    await bot.set_my_commands(USER_COMMANDS)  # default scope: все пользователи
    for admin_id in config.ADMIN_IDS:
        try:
            await bot.set_my_commands(
                USER_COMMANDS + ADMIN_COMMANDS,
                scope=BotCommandScopeChat(chat_id=admin_id),
            )
        except Exception as e:
            logger.warning("Не удалось задать команды для админа %s: %s", admin_id, e)


async def banner_scheduler(bot: Bot) -> None:
    """Периодически проверяет баннеры с включённой авто-рассылкой и отправляет их."""
    logger.info("Планировщик баннеров запущен (интервал проверки %s сек)", config.BANNER_CHECK_INTERVAL)
    while True:
        await asyncio.sleep(config.BANNER_CHECK_INTERVAL)
        try:
            for banner in get_due_banners():
                logger.info("Авто-рассылка баннера: %s", banner["name"])
                await broadcast_banner(bot, banner)
        except Exception:
            logger.exception("Ошибка в планировщике баннеров")


async def main():
    errors = config.check()
    if errors:
        for e in errors:
            logger.error(e)
        raise SystemExit("Ошибка конфигурации. Проверьте файл .env")

    init_db()
    config.load_runtime_settings()  # применяем настройки, изменённые админом

    bot = Bot(token=config.BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    room_manager.set_bot(bot)
    bot_room_manager.set_bot(bot)

    dp = Dispatcher()

    @dp.errors.register
    async def on_update_error(update, exception):
        logger.exception("Ошибка при обработке update %s: %s", update, exception)

    # порядок важен: common (глобальная отмена) идёт первым
    dp.include_router(common.router)
    dp.include_router(start.router)
    dp.include_router(rooms.router)
    dp.include_router(convert.router)
    dp.include_router(deposit.router)
    dp.include_router(promo.router)
    dp.include_router(withdraw.router)
    dp.include_router(transfer.router)
    dp.include_router(banner.router)
    dp.include_router(admin.router)

    await setup_commands(bot)
    await bot.delete_webhook(drop_pending_updates=True)

    asyncio.create_task(banner_scheduler(bot))
    logger.info("Бот запущен")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
