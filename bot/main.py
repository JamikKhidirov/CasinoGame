import asyncio
import atexit
import logging
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

# Позволяем запускать файл напрямую: python bot/main.py
_BOT_DIR = Path(__file__).resolve().parent
_ROOT_DIR = _BOT_DIR.parent
for _path in (str(_BOT_DIR), str(_ROOT_DIR / "configs")):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramUnauthorizedError
from aiogram.types import BotCommand, BotCommandScopeChat

import config
from database import get_due_banners, init_db
from handlers.admin import router as admin_router
from handlers.banner import router as banner_router
from handlers.common import router as common_router
from handlers.convert import router as convert_router
from handlers.deposit import router as deposit_router
from handlers.promo import router as promo_router
from handlers.rooms import router as rooms_router
from handlers.start import router as start_router
from handlers.transfer import router as transfer_router
from handlers.withdraw import router as withdraw_router
from services.banners import broadcast_banner
from services.rooms import bot_room_manager, room_manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

WEB_SERVER_JS = _ROOT_DIR / "casino" / "server.js"
_web_process: subprocess.Popen | None = None
_web_stopping = False

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


def web_port() -> int:
    try:
        return int(os.getenv("PORT", "3000"))
    except ValueError:
        return 3000


def _web_autostart_enabled() -> bool:
    return os.getenv("WEB_AUTOSTART", "1").strip().lower() not in {"0", "false", "no", "off"}


def _health_ok(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def _find_node() -> str | None:
    """Ищет Node.js: PATH → стандартные папки → Node.js из Visual Studio."""
    found = shutil.which("node")
    if found:
        return found

    candidates = [
        Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "nodejs" / "node.exe",
        Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "nodejs" / "node.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "nodejs" / "node.exe",
        Path("/usr/local/bin/node"),
        Path("/usr/bin/node"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)

    if os.name == "nt":
        import glob

        patterns = [
            r"C:\Program Files\Microsoft Visual Studio\*\*\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe",
            r"C:\Program Files (x86)\Microsoft Visual Studio\*\*\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe",
        ]
        for pattern in patterns:
            matches = sorted(glob.glob(pattern))
            if matches:
                return matches[-1]
    return None


def start_web_server(wait_seconds: float = 25.0) -> subprocess.Popen | None:
    """Поднимает Node.js-сервер сайта, если он ещё не запущен.

    Возвращает процесс сервера или None, если сайт уже работает,
    отключён через WEB_AUTOSTART=0 или Node.js не найден.
    """
    global _web_process
    if not _web_autostart_enabled():
        logger.info("WEB_AUTOSTART=0 — веб-сервер не запускаю")
        return None
    if not WEB_SERVER_JS.exists():
        logger.warning("Не найден %s — веб-сервер пропущен", WEB_SERVER_JS)
        return None

    port = web_port()
    if _health_ok(port):
        logger.info("Веб-сервер уже работает: http://localhost:%s", port)
        return None

    node = _find_node()
    if not node:
        logger.error("Node.js не найден — сайт не запустится (установите Node.js 18+)")
        return None

    env = os.environ.copy()
    env.setdefault("PORT", str(port))
    env["DB_PATH"] = str(Path(config.DB_PATH).resolve())  # один SQLite у бота и сайта

    logger.info("🚀 Запускаю веб-сервер: %s", WEB_SERVER_JS)
    try:
        proc = subprocess.Popen([node, str(WEB_SERVER_JS)], cwd=str(_ROOT_DIR), env=env)
    except OSError as exc:
        logger.error("Не удалось запустить веб-сервер: %s", exc)
        return None

    _web_process = proc
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            logger.error("Веб-сервер завершился с кодом %s", proc.returncode)
            _web_process = None
            return None
        if _health_ok(port):
            logger.info("🌐 Сайт доступен: http://localhost:%s", port)
            return proc
        time.sleep(0.3)

    logger.warning("Веб-сервер не ответил за %.0f сек, продолжаю без ожидания", wait_seconds)
    return proc


def stop_web_server() -> None:
    global _web_process, _web_stopping
    _web_stopping = True
    proc = _web_process
    _web_process = None
    if not proc or proc.poll() is not None:
        return
    logger.info("🛑 Останавливаю веб-сервер…")
    proc.terminate()
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()


async def web_supervisor(proc: subprocess.Popen) -> None:
    """Перезапускает сайт, если Node.js неожиданно упал."""
    current = proc
    while current and not _web_stopping:
        code = await asyncio.to_thread(current.wait)
        if _web_stopping:
            return
        logger.error("Веб-сервер упал (код %s). Перезапуск через 3 сек…", code)
        await asyncio.sleep(3)
        if _web_stopping:
            return
        current = await asyncio.to_thread(start_web_server)
        if not current:
            logger.error("Не удалось перезапустить веб-сервер")
            return


async def main():
    # 1) Сначала поднимаем сайт: python bot/main.py запускает и бота, и веб-казино.
    web_proc = await asyncio.to_thread(start_web_server)
    if web_proc:
        asyncio.create_task(web_supervisor(web_proc))

    errors = config.check()
    if errors:
        for e in errors:
            logger.error(e)
        if _health_ok(web_port()):
            logger.error("Бот не запущен, но сайт работает: http://localhost:%s", web_port())
            logger.error("Исправьте .env и перезапустите. Ctrl+C — выход.")
            await asyncio.Event().wait()
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
    dp.include_router(common_router)
    dp.include_router(start_router)
    dp.include_router(rooms_router)
    dp.include_router(convert_router)
    dp.include_router(deposit_router)
    dp.include_router(promo_router)
    dp.include_router(withdraw_router)
    dp.include_router(transfer_router)
    dp.include_router(banner_router)
    dp.include_router(admin_router)

    try:
        await setup_commands(bot)
        await bot.delete_webhook(drop_pending_updates=True)

        asyncio.create_task(banner_scheduler(bot))
        logger.info("🤖 Бот запущен")
        await dp.start_polling(bot)
    except TelegramUnauthorizedError:
        logger.error(
            "Telegram отклонил BOT_TOKEN (401 Unauthorized). "
            "Токен отозван или неверен — получите новый у @BotFather и обновите .env"
        )
        if not _health_ok(web_port()):
            raise
        logger.error("Сайт продолжает работать: http://localhost:%s", web_port())
        logger.error("Ctrl+C — выход.")
        await asyncio.Event().wait()


def _shutdown(signum, _frame):
    logger.info("Получен сигнал %s — завершаю работу", signum)
    stop_web_server()
    raise SystemExit(0)


if __name__ == "__main__":
    atexit.register(stop_web_server)
    for _signal_name in ("SIGINT", "SIGTERM"):
        _signal = getattr(signal, _signal_name, None)
        if _signal is not None:
            try:
                signal.signal(_signal, _shutdown)
            except (OSError, ValueError):  # не все сигналы доступны на Windows
                pass
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        stop_web_server()
