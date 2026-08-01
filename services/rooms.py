"""Менеджер комнат и игровой цикл.

Жизненный цикл комнаты:
  1) Создатель ставит ставку, появляется сообщение-комната (15 сек на вступление).
  2) Второй игрок вступает (кнопкой или ответом на сообщение) -> игра начинается.
  3) Игроки ходят по очереди. Если игрок не ходит 30 сек — бот делает ход за него.
  4) Результат: у кого больше — тот забирает банк (ставка*2 минус комиссия).
  5) Если за 15 сек никто не вступил — комната удаляется, ставка возвращается.

Специальный режим «игра с ботом» (vs_bot) — второй игрок это бот (BOT_ID),
после хода человека бот ходит сам через короткую паузу. Такие игры ведутся
отдельным менеджером (bot_room_manager) и на отдельной бесплатной валюте ⭐,
поэтому они не блокируют обычные игры между людьми.
"""

import asyncio
import logging
import random
import uuid

import config
from database import add_balance, add_points, deduct, deduct_points, record_game
from keyboards import room_kb, throw_kb
from services.games import GAMES
from utils import esc, fmt

logger = logging.getLogger(__name__)

BOT_ID = -1  # фиктивный id бота как игрока


class Room:
    def __init__(self, room_id: str, game_key: str, bet: int, chat_id: int,
                 creator_id: int, creator_name: str, currency: str = "balance"):
        self.room_id = room_id
        self.game_key = game_key
        self.bet = bet
        self.currency = currency  # "balance" (💰) или "points" (⭐)
        self.chat_id = chat_id
        self.creator_id = creator_id
        self.creator_name = creator_name
        self.message_id: int | None = None      # сообщение-комната (ожидание)
        self.started_msg_id: int | None = None  # сообщение-игра
        self.bot_msgs: list[int] = []           # все сообщения бота во время игры (для удаления)
        self.extra_msgs: list[int] = []         # чужие сообщения (кубик игрока) — пробуем удалить
        self.players: list[int] = [creator_id]
        self.names: dict[int, str] = {creator_id: creator_name}
        self.status = "waiting"                 # waiting -> playing -> finished
        self.moves: dict[int, object] = {}
        self.turn: int | None = None
        self.winner_id: int | None = None
        self.vs_bot = False
        self.join_task: asyncio.Task | None = None
        self.move_task: asyncio.Task | None = None
        self.manager: "RoomManager | None" = None  # менеджер-владелец (для правильных таймаутов)

    # ---------- валюта комнаты ----------

    @property
    def points(self) -> bool:
        return self.currency == "points"

    def bet_str(self) -> str:
        return fmt(self.bet)

    def _pay(self, user_id: int, amount: int, desc: str, win: bool = True) -> None:
        tx = "points_win" if self.points else "win"
        if self.points:
            add_points(user_id, amount, tx, desc)
        else:
            add_balance(user_id, amount, tx, desc)

    def _refund(self, user_id: int, amount: int, desc: str) -> None:
        if self.points:
            add_points(user_id, amount, "refund", desc)
        else:
            add_balance(user_id, amount, "refund", desc)


class RoomManager:
    def __init__(self, currency: str = "balance"):
        self.bot = None
        self.currency = currency
        self.rooms: dict[str, Room] = {}
        self.active: dict[int, str] = {}  # user_id -> room_id

    # ---------- инфраструктура ----------

    def set_bot(self, bot) -> None:
        self.bot = bot

    def get_room(self, room_id: str) -> Room | None:
        return self.rooms.get(room_id)

    def get_room_by_msg(self, chat_id: int, message_id: int) -> Room | None:
        for r in self.rooms.values():
            if r.chat_id == chat_id and r.message_id == message_id:
                return r
        return None

    def get_active_room_for(self, chat_id: int, user_id: int) -> Room | None:
        rid = self.active.get(user_id)
        if not rid:
            return None
        room = self.rooms.get(rid)
        if room and room.chat_id == chat_id:
            return room
        return None

    def is_active(self, user_id: int) -> bool:
        return user_id in self.active

    def cleanup(self, room: Room) -> None:
        self.rooms.pop(room.room_id, None)
        for uid in room.players:
            if self.active.get(uid) == room.room_id:
                self.active.pop(uid, None)

    def _schedule_result_delete(self, chat_id: int, message_ids: list[int] | None) -> None:
        """Удаляет все сообщения игры после паузы, не блокируя игроков."""
        if not message_ids:
            return

        async def _task():
            try:
                await asyncio.sleep(config.RESULT_MSG_TTL)
                for mid in message_ids:
                    await self.safe_delete(chat_id, mid)
            except asyncio.CancelledError:
                pass

        asyncio.create_task(_task())

    def _track(self, room: Room, message_id: int | None) -> None:
        if message_id:
            room.bot_msgs.append(message_id)

    # ---------- создание комнаты ----------

    async def create_room(self, chat_id: int, user_id: int, username: str,
                          game_key: str, bet: int) -> tuple[Room | None, str | None]:
        if self.is_active(user_id):
            return None, "Вы уже участвуете в активной игре!"
        if self.currency == "points":
            if deduct_points(user_id, bet, "Ставка очками (создание комнаты)") is None:
                return None, "Недостаточно очков ⭐ на счету."
        else:
            if deduct(user_id, bet, "Ставка (создание комнаты)") is None:
                return None, "Недостаточно средств на балансе."
        room = Room(
            room_id=uuid.uuid4().hex[:10],
            game_key=game_key,
            bet=bet,
            chat_id=chat_id,
            creator_id=user_id,
            creator_name=username,
            currency=self.currency,
        )
        room.manager = self
        self.rooms[room.room_id] = room
        self.active[user_id] = room.room_id
        return room, None

    async def send_room_message(self, room: Room) -> None:
        g = GAMES[room.game_key]
        cur = "⭐" if room.points else "💵"
        text = (
            f"🎮 <b>Комната создана!</b>\n"
            f"<blockquote>🎲 {g['emoji']} {g['name']} · Ставка: {room.bet_str()} {cur}</blockquote>\n"
            f"Владелец: <b>@{esc(room.creator_name)}</b>\n\n"
            f"⏳ Ожидание соперника: <b>{config.JOIN_TIMEOUT} сек.</b>\n"
            f"Нажмите «🎮 Присоединиться» или <b>ответьте на это сообщение</b> "
            f"(можно с суммой ставки), чтобы вступить в игру."
        )
        msg = await self.bot.send_message(room.chat_id, text, reply_markup=room_kb(room.room_id))
        room.message_id = msg.message_id
        room.join_task = asyncio.create_task(self.join_timeout(room))

    async def join_timeout(self, room: Room) -> None:
        try:
            await asyncio.sleep(config.JOIN_TIMEOUT)
            current = self.rooms.get(room.room_id)
            if current and current.status == "waiting":
                await self.close_room(current, "Никто не присоединился — комната удалена.")
        except asyncio.CancelledError:
            pass

    async def start_vs_bot(self, room: Room) -> None:
        room.players.append(BOT_ID)
        room.names[BOT_ID] = "🤖 Бот"
        room.vs_bot = True
        room.status = "playing"
        room.turn = room.players[0]
        await self.start_game(room)

    # ---------- вступление в игру ----------

    async def join_room(self, room: Room, user_id: int, username: str) -> tuple[bool, str | None]:
        if room.status != "waiting":
            return False, "Комната уже закрыта или игра началась."
        if user_id == room.creator_id:
            return False, "Это ваша комната. Присоединиться к своей игре нельзя."
        if self.is_active(user_id):
            return False, "Вы уже участвуете в активной игре."
        if room.points:
            if deduct_points(user_id, room.bet, "Ставка очками (вход в комнату)") is None:
                return False, "Недостаточно очков ⭐ на счету."
        else:
            if deduct(user_id, room.bet, "Ставка (вход в комнату)") is None:
                return False, "Недостаточно средств на балансе."
        room.players.append(user_id)
        room.names[user_id] = username
        self.active[user_id] = room.room_id
        if room.join_task:
            room.join_task.cancel()
        room.status = "playing"
        room.turn = room.players[0]
        await self.start_game(room)
        return True, None

    # ---------- игровой цикл ----------

    async def start_game(self, room: Room) -> None:
        g = GAMES[room.game_key]
        await self.delete_room_message(room)
        text = self.game_status_text(room)
        msg = await self.bot.send_message(room.chat_id, text, reply_markup=throw_kb(room))
        room.started_msg_id = msg.message_id
        self._track(room, msg.message_id)
        await self.schedule_move(room)

    def game_status_text(self, room: Room) -> str:
        g = GAMES[room.game_key]
        p1, p2 = room.players
        cur = "⭐" if room.points else ""
        head = (
            f"{g['emoji']} <b>Игра началась!</b>\n"
            f"<blockquote>🎮 {g['name']} | Ставка: {room.bet_str()} {cur}</blockquote>\n"
            f"Игроки: <b>{self._name(room, p1)}</b> против <b>{self._name(room, p2)}</b>"
        )
        if config.COMMISSION_PERCENT > 0:
            head += f"\nКомиссия казино: {config.COMMISSION_PERCENT}%"
        if room.status == "playing":
            if room.game_key == "coin":
                head += f"\n\n🪙 Выбор стороны:"
                for uid in room.players:
                    picked = room.moves.get(uid)
                    if picked:
                        head += f"\n{self._name(room, uid)}: {self._side_name(picked)} ✅"
                head += f"\n\n🕹 Ходит <b>{self._name(room, room.turn)}</b> — выберите сторону кнопками."
            else:
                head += (
                    f"\n\n🕹 Ходит <b>{self._name(room, room.turn)}</b>.\n"
                    f"Отправьте {g['emoji']} (можно ответом на это сообщение) "
                    f"или нажмите кнопку «Бросить»."
                )
        else:
            if room.winner_id is not None:
                head += f"\n\n🏆 Победитель: <b>{self._name(room, room.winner_id)}</b>"
            else:
                head += "\n\n🤝 Ничья — ставки возвращены."
        return head

    @staticmethod
    def _name(room: Room, uid: int) -> str:
        if uid == BOT_ID:
            return "🤖 Бот"
        return f"@{esc(room.names.get(uid, str(uid)))}"

    async def schedule_move(self, room: Room) -> None:
        if room.move_task:
            room.move_task.cancel()
        room.move_task = asyncio.create_task(self.move_timeout(room))

    async def move_timeout(self, room: Room) -> None:
        try:
            await asyncio.sleep(config.MOVE_TIMEOUT)
            current = self.rooms.get(room.room_id)
            if current and current.status == "playing" and current.turn is not None:
                m = await self.bot.send_message(
                    current.chat_id,
                    f"⏰ <b>{self._name(current, current.turn)}</b> не ходит — бот сделает ход за вас!",
                )
                self._track(current, m.message_id)
                await self.auto_move(current)
        except asyncio.CancelledError:
            pass

    async def bot_move_delay(self, room: Room) -> None:
        try:
            await asyncio.sleep(1.5)
            current = self.rooms.get(room.room_id)
            if current and current.status == "playing" and current.turn == BOT_ID:
                m = await self.bot.send_message(current.chat_id, "🤖 Бот делает свой ход...")
                self._track(current, m.message_id)
                await self.auto_move(current)
        except asyncio.CancelledError:
            pass

    async def send_roll_and_move(self, room: Room, user_id: int, auto: bool = False) -> None:
        """Имитация броска: бот кидает кубик (анимация), ждёт, пока он «докрутится»,
        и только потом раскрывает результат."""
        if room.status != "playing" or room.turn != user_id:
            return
        g = GAMES[room.game_key]
        sent = await self.bot.send_dice(room.chat_id, emoji=g["emoji"])
        self._track(room, sent.message_id)
        await asyncio.sleep(config.DICE_ROLL_DELAY)
        await self.make_move(room, user_id, sent.dice.value, auto=auto)

    async def auto_move(self, room: Room) -> None:
        if room.status != "playing":
            return
        user_id = room.turn
        if room.game_key == "coin":
            await self.make_move(room, user_id, random.choice(["heads", "tails"]), auto=True)
        else:
            await self.send_roll_and_move(room, user_id, auto=True)

    async def make_move(self, room: Room, user_id: int, value, auto: bool = False) -> None:
        if room.status != "playing" or room.turn != user_id:
            return
        g = GAMES[room.game_key]

        if room.game_key == "coin":
            side = "heads" if value == "heads" else "tails"
            other = self._opponent(room, user_id)
            other_side = room.moves.get(other)
            # сторона уже занята соперником
            if other_side is not None and other_side == side:
                if auto:
                    side = "tails" if other_side == "heads" else "heads"  # бот берёт свободную
                else:
                    await self.bot.send_message(
                        room.chat_id,
                        f"🪙 Сторона «{self._side_name(side)}» уже занята! Выберите другую.",
                    )
                    return
            room.moves[user_id] = side
            if auto:
                m = await self.bot.send_message(
                    room.chat_id,
                    f"🤖 Бот сделал ход за <b>{self._name(room, user_id)}</b>: "
                    f"выбрал «{self._side_name(side)}».",
                )
                self._track(room, m.message_id)
            # оба выбрали -> бросок монеты
            if other in room.moves:
                await self.finish_game(room)
                return
            room.turn = other
            if room.move_task:
                room.move_task.cancel()
            if other == BOT_ID:
                room.move_task = asyncio.create_task(self.bot_move_delay(room))
            else:
                room.move_task = asyncio.create_task(self.move_timeout(room))
            await self.update_game_message(room, self.game_status_text(room))
            return

        if room.game_key == "dart":
            value -= 1  # дротики: очки = выпавшее на кубике − 1
        room.moves[user_id] = value
        auto_note = " 🤖 (ход бота)" if auto else ""
        label = self._goal_label(room.game_key, value)
        if label:
            move_text = (
                f"{g['emoji']} <b>{self._name(room, user_id)}</b>: {label} ({value}){auto_note}!"
            )
        else:
            move_text = (
                f"{g['emoji']} <b>{self._name(room, user_id)}</b> выбрасывает <b>{value}</b>{auto_note}!"
            )
        m = await self.bot.send_message(room.chat_id, move_text)
        self._track(room, m.message_id)

        other = self._opponent(room, user_id)
        if other in room.moves:
            await self.finish_game(room)
            return

        room.turn = other
        if room.move_task:
            room.move_task.cancel()
        if other == BOT_ID:
            room.move_task = asyncio.create_task(self.bot_move_delay(room))
        else:
            room.move_task = asyncio.create_task(self.move_timeout(room))
        await self.update_game_message(room, self.game_status_text(room))

    @staticmethod
    def _opponent(room: Room, user_id: int) -> int:
        return room.players[1] if room.players[0] == user_id else room.players[0]

    @staticmethod
    def _side_name(side: str) -> str:
        return "Орёл 🦅" if side == "heads" else "Решка 🪙"

    @staticmethod
    def _goal_label(game_key: str, value: int) -> str | None:
        """Футбол/баскетбол: 3 и больше — гол, 2 и меньше — мимо."""
        if game_key in ("football", "basketball"):
            return "Гол ⚽" if value >= 3 else "Не гол ❌"
        return None

    @staticmethod
    def _record_stats(room: Room, results: dict[int, tuple[str, int]]) -> None:
        """results: user_id -> (win|lose|tie, net_amount). Статистику бота не пишем."""
        opponent = "bot" if room.vs_bot else "player"
        for uid, (result, amount) in results.items():
            if uid == BOT_ID:
                continue
            record_game(uid, room.game_key, room.bet, result, amount, opponent)

    # ---------- завершение ----------

    async def finish_game(self, room: Room) -> None:
        if room.status != "playing":
            return
        room.status = "finished"
        if room.move_task:
            room.move_task.cancel()
        g = GAMES[room.game_key]
        pot = room.bet * 2
        commission = int(pot * config.COMMISSION_PERCENT / 100)
        prize = pot - commission

        if room.game_key == "coin":
            await asyncio.sleep(config.DICE_ROLL_DELAY)  # имитация подбрасывания монетки
            flip = random.choice(["heads", "tails"])
            matched = [p for p in room.players if room.moves.get(p) == flip]
            if len(matched) == 1:
                w = matched[0]
                l = self._opponent(room, w)
                room.winner_id = w
                room._pay(w, prize, f"Победа в комнате {room.room_id}")
                self._record_stats(room, {w: ("win", prize - room.bet), l: ("lose", -room.bet)})
                text = (
                    f"🪙 Выпало: <b>{'Орёл 🦅' if flip == 'heads' else 'Решка 🪙'}</b>\n"
                    f"<blockquote>🏆 Победитель: <b>{self._name(room, w)}</b> +{self._prize_str(room, prize)}</blockquote>"
                )
            else:
                for p in room.players:
                    room._refund(p, room.bet, f"Ничья в комнате {room.room_id}")
                self._record_stats(room, {p: ("tie", 0) for p in room.players})
                room.winner_id = None
                tie_text = "🤝 Ничья! Ваша ставка возвращена — бот не выиграл." if room.vs_bot else "🤝 Ничья — ставки возвращены."
                text = f"🪙 Выпало: <b>{'Орёл 🦅' if flip == 'heads' else 'Решка 🪙'}</b>\n{tie_text}"
        else:
            p1, p2 = room.players
            v1, v2 = room.moves[p1], room.moves[p2]
            if room.game_key in ("football", "basketball"):
                l1 = self._goal_label(room.game_key, v1)
                l2 = self._goal_label(room.game_key, v2)
                line1 = f"{self._name(room, p1)}: {l1} ({v1})"
                line2 = f"{self._name(room, p2)}: {l2} ({v2})"
            else:
                line1 = f"{self._name(room, p1)}: {v1}"
                line2 = f"{self._name(room, p2)}: {v2}"
            text = (
                f"{g['emoji']} <b>Результаты:</b>\n"
                f"<blockquote><b>{line1}</b>\n<b>{line2}</b></blockquote>\n\n"
            )
            if v1 == v2:
                for p in room.players:
                    room._refund(p, room.bet, f"Ничья в комнате {room.room_id}")
                self._record_stats(room, {p: ("tie", 0) for p in room.players})
                room.winner_id = None  # ничья — победителя нет (в т.ч. против бота)
                if room.vs_bot:
                    text += "🤝 Ничья! Ваша ставка возвращена — бот не выиграл."
                else:
                    text += "🤝 Ничья — ставки возвращены."
            else:
                w = p1 if v1 > v2 else p2
                l = p2 if w == p1 else p1
                room.winner_id = w
                room._pay(w, prize, f"Победа в комнате {room.room_id}")
                self._record_stats(room, {w: ("win", prize - room.bet), l: ("lose", -room.bet)})
                text += f"<blockquote>🏆 Победитель: <b>{self._name(room, w)}</b> +{self._prize_str(room, prize)}</blockquote>"

        await self.update_game_message(room, text, None)
        chat_id, msg_ids = room.chat_id, list(room.bot_msgs) + list(room.extra_msgs)
        self.cleanup(room)
        self._schedule_result_delete(chat_id, msg_ids)
        return

    def _prize_str(self, room: Room, prize: int) -> str:
        return f"⭐ {fmt(prize)}" if room.points else fmt(prize)

    async def fold(self, room: Room, user_id: int) -> bool:
        if room.status != "playing" or user_id not in room.players or user_id == BOT_ID:
            return False
        room.status = "finished"
        if room.move_task:
            room.move_task.cancel()
        winner = self._opponent(room, user_id)
        room.winner_id = winner
        pot = room.bet * 2
        commission = int(pot * config.COMMISSION_PERCENT / 100)
        prize = pot - commission
        room._pay(winner, prize, f"Победа (соперник сдался) в комнате {room.room_id}")
        self._record_stats(room, {winner: ("win", prize - room.bet), user_id: ("lose", -room.bet)})
        text = (
            f"🏳️ <b>{self._name(room, user_id)}</b> сдался!\n"
            f"<blockquote>🏆 Победитель: <b>{self._name(room, winner)}</b> +{self._prize_str(room, prize)}</blockquote>"
        )
        await self.update_game_message(room, text, None)
        chat_id, msg_ids = room.chat_id, list(room.bot_msgs) + list(room.extra_msgs)
        self.cleanup(room)
        self._schedule_result_delete(chat_id, msg_ids)
        return True

    async def cancel_room(self, room: Room, user_id: int) -> tuple[bool, str | None]:
        if room.status != "waiting":
            return False, "Игра уже началась — отменить нельзя."
        if user_id != room.creator_id:
            return False, "Отменить комнату может только её создатель."
        room.status = "finished"
        if room.join_task:
            room.join_task.cancel()
        room._refund(room.creator_id, room.bet, f"Комната отменена ({room.room_id})")
        await self.delete_room_message(room)
        m = await self.bot.send_message(room.chat_id, "🚫 Комната отменена создателем.")
        self._schedule_result_delete(room.chat_id, [m.message_id])
        self.cleanup(room)
        return True, None

    async def close_room(self, room: Room, reason: str) -> None:
        """Закрытие комнаты в ожидании (не началась) — ставка возвращается."""
        if room.status == "finished":
            return
        room.status = "finished"
        if room.join_task:
            room.join_task.cancel()
        if room.move_task:
            room.move_task.cancel()
        if len(room.players) == 1:
            room._refund(room.creator_id, room.bet, f"Комната удалена ({room.room_id})")
        await self.delete_room_message(room)
        m = await self.bot.send_message(room.chat_id, f"🚫 {reason}")
        self._schedule_result_delete(room.chat_id, [m.message_id])
        self.cleanup(room)

    # ---------- вспомогательное ----------

    async def update_game_message(self, room: Room, text: str, kb=None) -> None:
        if kb is None:
            kb = throw_kb(room) if room.status == "playing" else None
        try:
            await self.bot.edit_message_text(text, room.chat_id, room.started_msg_id, reply_markup=kb)
        except Exception:
            try:
                msg = await self.bot.send_message(room.chat_id, text, reply_markup=kb)
                room.started_msg_id = msg.message_id
                self._track(room, msg.message_id)
            except Exception as e:
                logger.warning("update_game_message failed: %s", e)

    async def delete_room_message(self, room: Room) -> None:
        if not room.message_id:
            return
        mid = room.message_id
        room.message_id = None
        try:
            await self.bot.delete_message(room.chat_id, mid)
        except Exception:
            try:
                await self.bot.edit_message_text("Игра началась 👇", room.chat_id, mid)
            except Exception:
                pass

    async def safe_delete(self, chat_id: int, message_id: int | None) -> None:
        if not message_id:
            return
        try:
            await self.bot.delete_message(chat_id, message_id)
        except Exception:
            pass


room_manager = RoomManager()
bot_room_manager = RoomManager(currency="points")


def find_room(room_id: str) -> Room | None:
    """Ищет комнату в обоих менеджерах (люди и бот)."""
    return room_manager.get_room(room_id) or bot_room_manager.get_room(room_id)


def find_active_room(chat_id: int, user_id: int) -> Room | None:
    """Активная игра игрока в этом чате (сначала среди людей, потом с ботом)."""
    return (
        room_manager.get_active_room_for(chat_id, user_id)
        or bot_room_manager.get_active_room_for(chat_id, user_id)
    )
