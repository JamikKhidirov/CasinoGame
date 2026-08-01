from aiogram import F, Router
from aiogram.dispatcher.event.bases import SkipHandler
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

import asyncio

import config
from database import add_balance, ensure_user, get_user
from keyboards import BTN_CREATE, BTN_VSBOT, cancel_kb, games_kb, room_kb, throw_kb
from services.games import GAME_EMOJIS, GAMES
from services.rooms import bot_room_manager, find_active_room, find_room, room_manager
from utils import fmt

router = Router()


class CreateRoom(StatesGroup):
    game = State()
    bet = State()


def _username(msg: Message) -> str:
    return msg.from_user.username or (msg.from_user.first_name or str(msg.from_user.id))


# ============ Создание комнаты / игры с ботом ============

@router.message(Command("games"))
async def cmd_games(msg: Message, state: FSMContext):
    await start_create(msg, state)


@router.message(Command("bot"))
async def cmd_bot(msg: Message, state: FSMContext):
    await start_vs_bot(msg, state)


@router.message(F.text == BTN_CREATE)
async def start_create(msg: Message, state: FSMContext):
    await state.clear()
    await state.set_state(CreateRoom.game)
    await state.update_data(vs_bot=False)
    note = ""
    if msg.chat.type == "private":
        note = "\n\n⚠️ Комнаты удобнее создавать в группе — иначе соперник не увидит её. В личке используйте «Играть с ботом»."
    await msg.answer(f"Выберите игру:{note}", reply_markup=games_kb(vs_bot=False))


@router.message(F.text == BTN_VSBOT)
async def start_vs_bot(msg: Message, state: FSMContext):
    await state.clear()
    await state.set_state(CreateRoom.game)
    await state.update_data(vs_bot=True)
    await msg.answer("Выберите игру против бота:", reply_markup=games_kb(vs_bot=True))


@router.callback_query(CreateRoom.game, F.data.startswith("choose_game:"))
async def game_chosen(cb: CallbackQuery, state: FSMContext):
    _, vb, key = cb.data.split(":")
    g = GAMES.get(key)
    if not g:
        await cb.answer("Неизвестная игра", show_alert=True)
        return
    await state.update_data(game_key=key)
    await state.set_state(CreateRoom.bet)
    await cb.message.edit_text(
        f"Выбрано: {g['emoji']} {g['name']}\n\n"
        f"Введите сумму ставки (число от {fmt(config.MIN_BET)} до {fmt(config.MAX_BET)}):",
        reply_markup=cancel_kb(),
    )
    await cb.answer()


@router.message(CreateRoom.bet)
async def bet_input(msg: Message, state: FSMContext):
    text = (msg.text or "").strip()
    if not text.isdigit():
        await msg.answer("Введите сумму ставки числом:")
        return
    bet = int(text)
    data = await state.get_data()
    vs_bot = bool(data.get("vs_bot"))
    if vs_bot:
        min_b, max_b = config.POINTS_MIN_BET, config.POINTS_MAX_BET
        cur = "⭐"
    else:
        min_b, max_b = config.MIN_BET, config.MAX_BET
        cur = "💰"
    if bet < min_b:
        await msg.answer(f"Минимальная ставка: <b>{fmt(min_b)}</b> {cur}")
        return
    if bet > max_b:
        await msg.answer(f"Максимальная ставка: <b>{fmt(max_b)}</b> {cur}")
        return
    await state.clear()

    user = ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    if vs_bot:
        if user["points"] < bet:
            await msg.answer(
                f"❌ Недостаточно очков ⭐ на счету.\n"
                f"Ваши очки: <b>{fmt(user['points'])}</b>. "
                f"Очки даются бесплатно за игру с ботом — посмотрите /convert."
            )
            return
    elif user["balance"] < bet:
        await msg.answer("❌ Недостаточно средств на балансе.")
        return

    game_key = data.get("game_key")
    if game_key not in GAMES:
        await msg.answer("Что-то пошло не так — выберите игру заново.")
        return

    mgr = bot_room_manager if vs_bot else room_manager
    room, err = await mgr.create_room(
        msg.chat.id, msg.from_user.id, _username(msg), game_key, bet
    )
    if err:
        await msg.answer(f"❌ {err}")
        return

    try:
        if vs_bot:
            await mgr.start_vs_bot(room)
            await msg.answer(f"✅ Игра против бота! Ставка {fmt(bet)} ⭐. Удачи!")
        else:
            await mgr.send_room_message(room)
            await msg.answer(
                f"✅ Комната создана! Ожидание соперника {config.JOIN_TIMEOUT} сек."
            )
    except Exception:
        if vs_bot:
            from database import add_points
            add_points(msg.from_user.id, bet, "refund", f"Ошибка создания игры с ботом ({room.room_id})")
        else:
            add_balance(msg.from_user.id, bet, "refund", f"Ошибка создания комнаты ({room.room_id})")
        mgr.cleanup(room)
        raise


# ============ Вступление в игру ============

@router.message(F.reply_to_message)
async def reply_join(msg: Message):
    # Бросок кубика/эмодзи в ответе — это ход, а не вступление в комнату
    if msg.dice:
        raise SkipHandler
    rtm = msg.reply_to_message
    room = room_manager.get_room_by_msg(rtm.chat.id, rtm.message_id)
    # Ответ не на сообщение-комнату — пусть обработают другие хендлеры (промокод, перевод и т.п.)
    if not room:
        raise SkipHandler
    if room.status != "waiting":
        await msg.answer("Эта комната уже закрыта.")
        return
    if msg.text and msg.text.strip().isdigit() and int(msg.text.strip()) != room.bet:
        await msg.answer(
            f"⚠️ Ставка в этой комнате: <b>{fmt(room.bet)}</b>. "
            f"Отправьте {fmt(room.bet)} или просто ответьте без числа."
        )
        return
    ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
    ok, err = await room_manager.join_room(room, msg.from_user.id, _username(msg))
    if ok:
        await msg.answer("✅ Вы в игре! Удачи!")
    else:
        await msg.answer(f"❌ {err}")


@router.callback_query(F.data.startswith("room:join:"))
async def join_button(cb: CallbackQuery):
    room = room_manager.get_room(cb.data.split(":")[2])
    if not room or room.status != "waiting":
        await cb.answer("Комната уже удалена или игра началась.", show_alert=True)
        return
    ensure_user(cb.from_user.id, cb.from_user.username, cb.from_user.first_name)
    username = cb.from_user.username or (cb.from_user.first_name or str(cb.from_user.id))
    ok, err = await room_manager.join_room(room, cb.from_user.id, username)
    if ok:
        await cb.answer("✅ Вы в игре!")
    else:
        await cb.answer(err, show_alert=True)


@router.callback_query(F.data.startswith("room:cancel:"))
async def cancel_button(cb: CallbackQuery):
    room = room_manager.get_room(cb.data.split(":")[2])
    if not room:
        await cb.answer("Комната уже удалена.", show_alert=True)
        return
    ok, err = await room_manager.cancel_room(room, cb.from_user.id)
    if ok:
        await cb.answer("Комната отменена.")
    else:
        await cb.answer(err, show_alert=True)


@router.callback_query(F.data.startswith("game:throw:"))
async def throw_button(cb: CallbackQuery):
    room = find_room(cb.data.split(":")[2])
    if not room or room.status != "playing":
        await cb.answer("Игра уже завершена.", show_alert=True)
        return
    if room.turn != cb.from_user.id:
        await cb.answer("Сейчас не ваш ход!", show_alert=True)
        return
    if room.game_key == "coin":
        await cb.answer("🪙 В этой игре сторону выбирают кнопками ниже.", show_alert=True)
        return
    await cb.answer("🎲 Бросок...")
    await room.manager.send_roll_and_move(room, cb.from_user.id)


# ============ Ходы ============

@router.callback_query(F.data.startswith("game:side:"))
async def side_button(cb: CallbackQuery):
    _, _, room_id, side = cb.data.split(":")
    room = find_room(room_id)
    if not room or room.status != "playing":
        await cb.answer("Игра уже завершена.", show_alert=True)
        return
    if room.turn != cb.from_user.id:
        await cb.answer("Сейчас не ваш ход!", show_alert=True)
        return
    await cb.answer()
    await room.manager.make_move(room, cb.from_user.id, side)


@router.callback_query(F.data.startswith("game:fold:"))
async def fold_button(cb: CallbackQuery):
    room = find_room(cb.data.split(":")[2])
    if not room or room.status != "playing":
        await cb.answer("Игра уже завершена.", show_alert=True)
        return
    if cb.from_user.id not in room.players:
        await cb.answer("Вы не в этой игре.", show_alert=True)
        return
    await cb.answer("Вы сдались!")
    await room.manager.fold(room, cb.from_user.id)


@router.message(F.dice)
async def dice_throw(msg: Message):
    room = find_active_room(msg.chat.id, msg.from_user.id)
    if not room or room.status != "playing":
        return
    if room.game_key == "coin":
        await msg.answer("🪙 В этой игре сторону выбирают кнопками под сообщением игры.")
        return
    if room.turn != msg.from_user.id:
        await msg.answer("⏳ Сейчас ход другого игрока.")
        return
    g = GAMES[room.game_key]
    if msg.dice.emoji != g["emoji"]:
        await msg.answer(f"Для игры «{g['name']}» нужно бросить {g['emoji']}.")
        return
    # имитация «вращения»: пока анимация крутится, не раскрываем результат сразу
    await asyncio.sleep(config.DICE_ROLL_DELAY)
    room.extra_msgs.append(msg.message_id)
    await room.manager.make_move(room, msg.from_user.id, msg.dice.value)


@router.message(F.text.in_(GAME_EMOJIS))
async def emoji_throw(msg: Message):
    """Если игрок прислал именно эмодзи игры (без нативной анимации) — считаем ходом.
    Бот сам кидает анимированный кубик, чтобы была имитация броска."""
    room = find_active_room(msg.chat.id, msg.from_user.id)
    if not room or room.status != "playing":
        return
    if room.game_key == "coin":
        return
    if room.turn != msg.from_user.id:
        return
    g = GAMES[room.game_key]
    if msg.text.strip() != g["emoji"]:
        return
    room.extra_msgs.append(msg.message_id)
    await room.manager.send_roll_and_move(room, msg.from_user.id)
