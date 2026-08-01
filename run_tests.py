"""Полный смоук-тест всех фич бота."""
import asyncio
import os
import sys
import time

os.environ["DB_PATH"] = "final_test.db"
if os.path.exists("final_test.db"):
    os.remove("final_test.db")

import database
from services.banners import broadcast_banner
from services.rooms import BOT_ID, bot_room_manager, room_manager

PASSED = 0
FAILED = []


def check(name: str, cond: bool, extra: str = ""):
    global PASSED
    if cond:
        PASSED += 1
        print(f"  OK  {name}")
    else:
        FAILED.append(name)
        print(f"  FAIL {name} {extra}")


class FakeMsg:
    def __init__(self, message_id, chat_id=1, dice_value=None):
        self.message_id = message_id
        self.chat = type("C", (), {"id": chat_id})()
        self.dice = type("D", (), {"value": dice_value})() if dice_value else None


class FakeBot:
    def __init__(self):
        self.mid = 0
        self.next_dice = []
        self.sent = []
        self.deleted = []

    async def send_message(self, chat_id, text, reply_markup=None, **kw):
        self.mid += 1
        self.sent.append(self.mid)
        return FakeMsg(self.mid, chat_id)

    async def send_photo(self, chat_id, photo, caption=None, reply_markup=None, **kw):
        self.mid += 1
        self.sent.append(self.mid)
        return FakeMsg(self.mid, chat_id)

    async def edit_message_text(self, text, chat_id, message_id, reply_markup=None, **kw):
        return True

    async def send_dice(self, chat_id, emoji=None):
        self.mid += 1
        val = self.next_dice.pop(0) if self.next_dice else 1
        self.sent.append(self.mid)
        return FakeMsg(self.mid, chat_id, dice_value=val)

    async def delete_message(self, chat_id, message_id):
        self.deleted.append(message_id)


async def test_db():
    print("DB:")
    database.init_db()
    for uid, name in [(1, "alice"), (2, "bob"), (3, "carol"), (4, "dave")]:
        database.ensure_user(uid, name, name.capitalize())

    check("стартовый баланс 1000", database.get_balance(1) == 1000)
    check("стартовые очки 2000", database.get_points(1) == 2000)
    check("очки: начисление", database.add_points(1, 500, "points_win", "test") == 2500)
    check("очки: списание", database.deduct_points(1, 300, "x") == 2200)
    check("очки: недостаточно", database.deduct_points(1, 10 ** 9, "x") is None)
    check("топ по очкам", len(database.get_top_points(10)) == 4)
    check("депозит", database.add_balance(1, 500, "deposit", "test", admin_id=9) == 1500)
    check("недостаточно средств", database.deduct(1, 999999, "x") is None)
    check("списание", database.deduct(1, 100, "bet") == 1400)
    check("поиск по @username", database.find_user("@ALICE")["id"] == 1)
    check("поиск по id", database.find_user("2")["id"] == 2)

    check("создание промокода", database.create_promocode("BONUS", 250, 2, 9))
    check("дубль промокода запрещён", not database.create_promocode("BONUS", 250, 2, 9))
    check("активация", database.claim_promocode("bonus", 2) == "ok")
    check("повторная активация", database.claim_promocode("bonus", 2) == "already")
    check("активация другим", database.claim_promocode("bonus", 3) == "ok")
    check("исчерпан", database.claim_promocode("bonus", 4) == "exhausted")

    b1 = database.get_balance(1)
    check("перевод", database.transfer(1, 2, 100))
    check("перевод без денег", not database.transfer(1, 2, 10 ** 9))
    check("баланс отправителя", database.get_balance(1) == b1 - 100)

    w = database.create_withdrawal(2, 300)
    check("заявка на вывод", w > 0)
    check("заявка в списке pending", any(x["id"] == w for x in database.get_pending_withdrawals()))
    before = database.get_balance(2)
    database.change_balance(2, -300, "hold", f"Заявка #{w}")
    check("средства заморожены", database.get_balance(2) == before - 300)
    r = database.resolve_withdrawal(w, "rejected", 9)
    check("отклонение возвращает средства", r is not None and database.get_balance(2) == before)

    # carol: 1000 старт + 250 промо = 1250; заявка 200 -> hold 1050; approve ничего не возвращает
    w2 = database.create_withdrawal(3, 200)
    database.change_balance(3, -200, "hold", f"Заявка #{w2}")
    database.resolve_withdrawal(w2, "approved", 9)
    check("одобрение не возвращает", database.get_balance(3) == 1250 - 200)
    check("повторная обработка", database.resolve_withdrawal(w2, "approved", 9) is None)

    # пополнения (заявка -> подтверждение админом)
    d = database.create_deposit(2, 500)
    check("заявка на пополнение", d > 0)
    check("пополнение в pending", any(x["id"] == d for x in database.get_pending_deposits()))
    bal2 = database.get_balance(2)
    dr = database.resolve_deposit(d, True, 9)
    check("подтверждение начисляет", dr is not None and database.get_balance(2) == bal2 + 500)
    d2 = database.create_deposit(3, 300)
    database.resolve_deposit(d2, False, 9)
    check("отклонение не начисляет", database.get_balance(3) == 1250 - 200)
    check("повторная обработка пополнения", database.resolve_deposit(d, True, 9) is None)

    # настройки из админки
    import config as cfgx
    database.set_setting("RESULT_MSG_TTL", "9")
    check("настройка сохранена", database.get_all_settings().get("RESULT_MSG_TTL") == "9")
    cfgx.load_runtime_settings()
    check("runtime-настройка применена", cfgx.RESULT_MSG_TTL == 9)
    database.set_setting("RESULT_MSG_TTL", "15")
    cfgx.load_runtime_settings()

    # строковые настройки (донат-карта) тоже переживают round-trip
    database.set_setting("DONATE_CARD_NUMBER", "2202202045612345")
    cfgx.load_runtime_settings()
    check("строковая настройка применена", cfgx.DONATE_CARD_NUMBER == "2202202045612345")
    check("настройка в SETTINGS строка", isinstance(cfgx.SETTINGS["DONATE_CARD_NUMBER"][1], str))
    database.set_setting("DONATE_CARD_NUMBER", cfgx.DONATE_CARD_NUMBER)

    database.record_game(1, "dice", 100, "win", 100, "player")
    database.record_game(1, "dice", 100, "win", 100, "bot")
    database.record_game(1, "dart", 50, "lose", -50, "player")
    database.record_game(1, "dice", 10, "tie", 0, "player")
    s = database.get_user_stats(1)
    check("статистика: всего игр", s["total"] == 4)
    check("статистика: победы", s["wins"] == 2)
    check("статистика: любимая игра", s["favorite"]["game_key"] == "dice")
    check("статистика: итог", s["net"] == 150)
    check("топ игроков", len(database.get_top_users(10)) == 4)

    bid = database.create_banner("Тест", "Заголовок", "Описание <b>текста</b>", None, "Играть", "https://t.me/x", 30)
    check("создание баннера", bid > 0)
    b = database.get_banner(bid)
    check("баннер на месте", b["interval_minutes"] == 30 and b["enabled"] == 1)
    due_before = len(database.get_due_banners(int(time.time())))
    database.mark_banner_sent(bid, int(time.time()))
    check("после отправки не в списке due", len(database.get_due_banners(int(time.time()))) == due_before - 1)
    check("запись доставки", not database.user_received_banner(bid, 1))
    database.record_banner_send(bid, 1)
    check("доставка записана", database.user_received_banner(bid, 1))
    database.set_banner_enabled(bid, False)
    check("баннер выключен", database.get_banner(bid)["enabled"] == 0)
    database.delete_banner(bid)
    check("баннер удалён", database.get_banner(bid) is None)
    check("список пользователей", set(database.get_all_user_ids()) == {1, 2, 3, 4})

    from handlers.transfer import _card_number_fmt
    check("донат: формат карты 4+4+4+4", _card_number_fmt("2202202045612345") == "2202 2020 4561 2345")
    check("донат: формат с пробелами", _card_number_fmt("2202 2020 4561 2345") == "2202 2020 4561 2345")


async def test_rooms():
    print("ROOMS:")
    import config as cfg
    cfg.DICE_ROLL_DELAY = 0.1  # в тестах «вращение» почти мгновенное

    # свежие пользователи с чистым балансом 1000
    for uid, name in [(101, "r_alice"), (102, "r_bob"), (103, "r_carol")]:
        database.ensure_user(uid, name, name)

    bot = FakeBot()
    room_manager.set_bot(bot)
    A, B, C = 101, 102, 103

    # таймаут комнаты -> возврат
    cfg.JOIN_TIMEOUT = 0.5
    room, err = await room_manager.create_room(1, A, "r_alice", "dice", 100)
    check("создание комнаты", room is not None and err is None)
    await room_manager.send_room_message(room)
    await asyncio.sleep(1)
    check("комната удалилась по таймауту", room_manager.get_room(room.room_id) is None)
    check("ставка возвращена", database.get_balance(A) == 1000)

    # полная игра
    cfg.JOIN_TIMEOUT = 15
    room, _ = await room_manager.create_room(1, A, "r_alice", "dice", 100)
    await room_manager.send_room_message(room)
    ok, err = await room_manager.join_room(room, B, "r_bob")
    check("вступление второго", ok and err is None)
    check("ставки списаны", database.get_balance(A) == 900 and database.get_balance(B) == 900)
    check("игра началась, ход alice", room.status == "playing" and room.turn == A)
    await room_manager.make_move(room, B, 6)
    check("нельзя играть за нехода (ходов нет)", room.moves == {})
    await room_manager.make_move(room, A, 5)
    check("ход передан bob", room.turn == B)
    await room_manager.make_move(room, B, 2)
    check("игра завершена", room.status == "finished")
    check("alice победила", room.winner_id == A)
    check("alice получила банк", database.get_balance(A) == 900 + 200)
    check("bob проиграл ставку", database.get_balance(B) == 900)
    check("комната очищена", room_manager.get_room(room.room_id) is None)
    check("игроки свободны", not room_manager.is_active(A) and not room_manager.is_active(B))
    st = database.get_user_stats(A)
    check("статистика записана", st["total"] == 1 and st["wins"] == 1 and st["by_game"][0]["game_key"] == "dice")

    # удаление всех сообщений бота после игры
    cfg.RESULT_MSG_TTL = 0.2
    bot.deleted = []
    bot.sent = []
    room, _ = await room_manager.create_room(1, A, "r_alice", "dice", 10)
    await room_manager.send_room_message(room)
    await room_manager.join_room(room, B, "r_bob")
    await room_manager.make_move(room, A, 5)
    await room_manager.make_move(room, B, 2)
    check("удаление: игра завершена", room.status == "finished")
    await asyncio.sleep(0.8)
    undeleted = [mid for mid in bot.sent if mid not in bot.deleted]
    check("удаление: все сообщения бота стёрты", undeleted == [], f"остались {undeleted}")

    # ничья -> возврат
    room, _ = await room_manager.create_room(1, A, "r_alice", "dart", 50)
    await room_manager.send_room_message(room)
    await room_manager.join_room(room, C, "r_carol")
    await room_manager.make_move(room, A, 4)
    await room_manager.make_move(room, C, 4)
    check("ничья", room.status == "finished" and room.winner_id is None)
    check("ничья: возврат alice", database.get_balance(A) == 1110)
    check("ничья: возврат carol", database.get_balance(C) == 1000)

    # дротики: очки = выпавшее − 1
    room, _ = await room_manager.create_room(1, A, "r_alice", "dart", 30)
    await room_manager.send_room_message(room)
    await room_manager.join_room(room, B, "r_bob")
    await room_manager.make_move(room, A, 3)
    check("дротики: 3 -> 2", room.moves.get(A) == 2)
    await room_manager.make_move(room, B, 1)
    check("дротики: 1 -> 0", room.moves.get(B) == 0)
    check("дротики: игра завершена", room.status == "finished")

    # футбол: гол = 3+, не гол = меньше 3 (выше очко побеждает)
    room, _ = await room_manager.create_room(1, A, "r_alice", "football", 30)
    await room_manager.send_room_message(room)
    await room_manager.join_room(room, B, "r_bob")
    await room_manager.make_move(room, A, 4)
    check("футбол: гол не стирается в 0/1 (считаем очки)", room.moves.get(A) == 4)
    await room_manager.make_move(room, B, 2)
    check("футбол: 4 > 2 — alice победила", room.winner_id == A)

    # владелец-менеджер привязан к комнате (фикс «бот не ходит»)
    hroom, _ = await room_manager.create_room(1, A, "r_alice", "dice", 10)
    check("человеческая комната привязана к room_manager", hroom.manager is room_manager)
    ok, _ = await room_manager.cancel_room(hroom, A)
    check("комната-привязка отменена", ok)
    check("игрок снова свободен", not room_manager.is_active(A))

    # авто-ход бота
    cfg.MOVE_TIMEOUT = 0.5
    room, _ = await room_manager.create_room(1, A, "r_alice", "football", 10)
    await room_manager.send_room_message(room)
    await room_manager.join_room(room, B, "r_bob")
    await asyncio.sleep(2.0)
    check("авто-ход завершил игру", room.status == "finished")

    # сдаться
    cfg.MOVE_TIMEOUT = 30
    room, _ = await room_manager.create_room(1, A, "r_alice", "basketball", 20)
    await room_manager.send_room_message(room)
    await room_manager.join_room(room, B, "r_bob")
    check("сдаться", await room_manager.fold(room, B))
    check("победа при сдаче", room.winner_id == A)

    # отмена комнаты
    room, _ = await room_manager.create_room(1, A, "r_alice", "dice", 30)
    await room_manager.send_room_message(room)
    ok, _ = await room_manager.cancel_room(room, A)
    check("отмена комнаты", ok)

    # игра с ботом на бесплатных очках (отдельный менеджер, валюта ⭐)
    bot_room_manager.set_bot(bot)
    pts = database.get_points(A)
    bal = database.get_balance(A)
    bot.next_dice = [1]
    room, _ = await bot_room_manager.create_room(1, A, "r_alice", "dice", 25)
    check("бот-комната на очках", room is not None and room.points)
    check("очки списаны за ставку", database.get_points(A) == pts - 25)
    await bot_room_manager.start_vs_bot(room)
    check("vs bot: второй игрок бот", room.vs_bot and BOT_ID in room.players)
    await bot_room_manager.make_move(room, A, 3)
    await asyncio.sleep(3)
    check("vs bot: игра завершена", room.status == "finished")
    check("vs bot: alice выиграла", room.winner_id == A)
    check("vs bot: приз начислен очками", database.get_points(A) == pts - 25 + 50)
    check("vs bot: баланс не тронут", database.get_balance(A) == bal)
    check("vs bot: юзер не занят в менеджере людей", not room_manager.is_active(A))
    check("vs bot: юзер не занят в менеджере бота", not bot_room_manager.is_active(A))

    # ничья с ботом: ставка возвращается, бот НЕ выигрывает
    pts = database.get_points(A)
    bot.next_dice = [2]
    room, _ = await bot_room_manager.create_room(1, A, "r_alice", "dice", 30)
    await bot_room_manager.start_vs_bot(room)
    await bot_room_manager.make_move(room, A, 2)
    await asyncio.sleep(2)
    check("vs bot: ничья — победителя нет", room.status == "finished" and room.winner_id is None)
    check("vs bot: ничья — ставка возвращена", database.get_points(A) == pts)
    check("vs bot: ничья — бот не выиграл очки", database.get_points(BOT_ID) < 100)

    # монетка: оба игрока выбирают сторону
    room, _ = await room_manager.create_room(1, A, "r_alice", "coin", 40)
    await room_manager.send_room_message(room)
    await room_manager.join_room(room, B, "r_bob")
    await room_manager.make_move(room, A, "heads")
    check("монетка: ход передан bob", room.status == "playing" and room.turn == B)
    await room_manager.make_move(room, B, "heads")
    check("монетка: занятую сторону нельзя", room.status == "playing" and room.moves.get(B) is None)
    await room_manager.make_move(room, B, "tails")
    check("монетка завершена", room.status == "finished")

    # защита от повторного входа
    room, _ = await room_manager.create_room(1, A, "r_alice", "dice", 10)
    await room_manager.send_room_message(room)
    ok, _ = await room_manager.join_room(room, B, "r_bob")
    check("вступление в игру", ok)
    room2, err = await room_manager.create_room(1, A, "r_alice", "dice", 10)
    check("нельзя быть в двух играх", room2 is None and "актив" in err)

    # но игра с ботом НЕ блокируется игрой с людьми (отдельные очки и менеджер)
    pts = database.get_points(A)
    brooms, err = await bot_room_manager.create_room(1, A, "r_alice", "dice", 5)
    check("игра с ботом при активной игре с людьми", brooms is not None and err is None)
    check("очки списаны", database.get_points(A) == pts - 5)


async def test_broadcast():
    print("BROADCAST:")
    bot = FakeBot()
    database.init_db()
    bid = database.create_banner("Реклама", "Акция", "Описание", None, "Играть", "https://t.me/x", 0)
    banner = database.get_banner(bid)
    sent, failed = await broadcast_banner(bot, banner)
    check(f"рассылка всем юзерам (отправлено {sent}, ошибок {failed})", sent == 7 and failed == 0)
    sent2, _ = await broadcast_banner(bot, banner)
    check("повторная рассылка никому", sent2 == 0)
    check("все получили", all(database.user_received_banner(bid, uid) for uid in database.get_all_user_ids()))
    database.delete_banner(bid)


async def main():
    await test_db()
    await test_rooms()
    await test_broadcast()
    print()
    if FAILED:
        print(f"ПРОВАЛЕНО: {len(FAILED)} тестов -> {FAILED}")
        sys.exit(1)
    print(f"ВСЕ ТЕСТЫ ПРОЙДЕНЫ ({PASSED})")


if __name__ == "__main__":
    asyncio.run(main())
