from aiogram import F, Router
from aiogram.filters import Command, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message

from database import claim_promocode, ensure_user, get_user
from keyboards import BTN_PROMO, main_kb
from utils import fmt

router = Router()


class Promo(StatesGroup):
    code = State()


def normalize_code(raw: str) -> str:
    """Убирает из кода лишнее (пользователь может вставить скопированную ссылку)."""
    code = (raw or "").strip().upper()
    for prefix in ("HTTPS://T.ME/C/", "HTTP://T.ME/C/", "T.ME/C/", "T.ME/"):
        if code.startswith(prefix):
            code = code[len(prefix):]
            break
    return code


def promo_copy_line(code: str) -> str:
    """Ссылка-код: Telegram показывает кнопку Copy, а бот распознаёт её при вводе."""
    return f"https://t.me/c/{code}"


@router.message(F.text == BTN_PROMO)
async def promo_menu(msg: Message, state: FSMContext):
    await state.clear()
    await state.set_state(Promo.code)
    await msg.answer("Введите промокод (или скопированную ссылку):")


@router.message(Command("promo"))
async def promo_cmd(msg: Message, command: CommandObject, state: FSMContext):
    ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    code = normalize_code(command.args)
    if not code:
        await state.set_state(Promo.code)
        await msg.answer("Использование: /promo <b>CODE</b>\nИли просто введите промокод:")
        return
    await apply_promo(msg, code)


@router.message(Promo.code)
async def promo_input(msg: Message, state: FSMContext):
    await state.clear()
    ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    await apply_promo(msg, normalize_code(msg.text))


async def apply_promo(msg: Message, code: str):
    if not code:
        await msg.answer("Введите промокод:")
        return
    res = claim_promocode(code, msg.from_user.id)
    if res == "not_found":
        await msg.answer("❌ Промокод не найден.")
    elif res == "already":
        await msg.answer("❌ Вы уже активировали этот промокод.")
    elif res == "exhausted":
        await msg.answer("❌ Промокод исчерпан (лимит активаций закончился).")
    else:
        user = get_user(msg.from_user.id)
        await msg.answer(
            f"✅ <b>Промокод <code>{code.upper()}</code> активирован!</b>\n\n"
            f"<blockquote>Новый баланс: <b>{fmt(user['balance'])}</b> 💰</blockquote>",
            reply_markup=main_kb(),
        )

