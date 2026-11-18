import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useApp } from "../context/AppContext.jsx";
import { GAMES, OUTCOME, fmt, guestIdentity, playerName } from "../lib/format.js";
import { getSocket } from "../lib/socket.js";

function Card({ card, hidden }) {
  if (hidden || !card) {
    return <div className="playing-card card-back">✦</div>;
  }
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div className={`playing-card${red ? " red" : ""}`}>
      <span className="card-rank">{card.name}</span>
      <span className="card-suit">{card.suit}</span>
    </div>
  );
}

function playerStatus(room, player) {
  if (room.gameType === "blackjack") {
    if (player.busted) return "Перебор";
    if (player.stood) return "Пас";
    if (room.currentTurn === player.id && room.status === "playing") return "Ходит";
    return "В игре";
  }
  if (room.gameType === "durak") {
    if (player.out) return "Вышел 🎉";
    if (room.attacker === player.id) return "Атакует";
    if (room.defender === player.id) return "Отбивается";
    return "В игре";
  }
  if (room.gameType === "dice") {
    return player.dice ? `Выбросил ${player.dice}` : "Ждёт броска";
  }
  return "";
}

function nameOf(room, userId) {
  if (!userId) return "—";
  const player = room.players.find((item) => item.id === userId);
  return player ? player.name : "—";
}

function PlayersGrid({ room }) {
  return (
    <div className="players-grid">
      {room.players.map((player) => {
        const isMe = player.id === room.yourId;
        const isTurn = room.currentTurn === player.id && room.status === "playing";
        let hand = null;
        const cards = [];
        if (room.gameType === "blackjack" || room.gameType === "durak") {
          for (const card of player.hand || []) cards.push(<Card key={card.id} card={card} />);
          const hiddenCount = Math.max(0, (player.handCount || 0) - (player.hand || []).length);
          for (let i = 0; i < hiddenCount; i += 1) cards.push(<Card key={`hidden-${i}`} hidden />);
          if (cards.length) hand = <div className="cards-row mini">{cards}</div>;
        }
        return (
          <div
            key={player.id}
            className={`player-card${isMe ? " is-me" : ""}${isTurn ? " is-turn" : ""}${player.connected === false ? " offline" : ""}`}
          >
            <div className="player-card-head">
              <span className="player-name">
                {isMe ? "🫵 " : ""}
                {player.name}
              </span>
              {room.gameType === "blackjack" && player.score !== null && player.score !== undefined ? (
                <span className="score-badge">{player.score}</span>
              ) : null}
            </div>
            <div className="muted small">{playerStatus(room, player)}</div>
            {hand}
            {!player.isBot && player.balance !== undefined ? (
              <div className="muted small">💳 {fmt(player.balance)}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function GamePage() {
  const { token, user, notify, refresh } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const roomIdParam = (params.get("room") || "").toUpperCase();
  const guest = useMemo(() => guestIdentity(), []);
  const name = useMemo(
    () => params.get("name") || (user ? playerName(user) : guest.name),
    [params, user, guest.name]
  );

  const [room, setRoom] = useState(null);
  const [balance, setBalance] = useState(user?.balance ?? 0);
  const [joined, setJoined] = useState(false);
  const [fatal, setFatal] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const myIdRef = useRef(null);

  useEffect(() => {
    if (user) setBalance(user.balance);
  }, [user]);

  useEffect(() => {
    if (!roomIdParam) {
      setFatal("Комната не выбрана");
      return undefined;
    }
    const socket = getSocket();
    let alive = true;

    const join = () => {
      socket.emit("join", {
        sessionToken: token || undefined,
        userId: guest.id,
        userName: name,
        roomId: roomIdParam,
      });
    };

    const onRoom = (state) => {
      if (!alive) return;
      myIdRef.current = state.yourId;
      setRoom(state);
      const me = state.players?.find((player) => player.id === state.yourId);
      if (me && Number.isFinite(me.balance)) setBalance(me.balance);
    };

    const onBalance = (data) => {
      if (Number.isFinite(data?.balance)) setBalance(data.balance);
    };

    const onJoined = () => {
      if (!alive) return;
      setJoined(true);
      refresh();
    };

    const onError = (data) => {
      if (!alive) return;
      const message = data?.message || "Ошибка";
      notify(message, "error");
      setActionBusy(false);
      if (!joined && /не найдена|началась|переполнена/i.test(message)) {
        setFatal(message);
      }
    };

    const onStarted = ({ gameType }) => {
      const info = GAMES[gameType] || GAMES.blackjack;
      notify(`Игра началась: ${info.title}`, "success");
    };

    const onFinished = ({ winner }) => {
      if (Array.isArray(winner) && winner.includes(myIdRef.current)) {
        notify("🏆 Вы победили!", "success");
      }
      refresh();
    };

    const onDisconnect = () => notify("Соединение потеряно. Переподключаемся…", "error");
    const onReconnect = () => {
      notify("Соединение восстановлено", "success");
      join();
    };

    socket.on("roomUpdated", onRoom);
    socket.on("balance", onBalance);
    socket.on("joined", onJoined);
    socket.on("error", onError);
    socket.on("gameStarted", onStarted);
    socket.on("gameFinished", onFinished);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect", onReconnect);

    socket.on("connect", join);
    if (socket.connected) join();

    return () => {
      alive = false;
      // Уходим из комнаты при переходе на другую страницу, иначе она
      // останется висеть в списке активных, пока не сработает таймаут.
      socket.emit("leaveRoom");
      socket.off("roomUpdated", onRoom);
      socket.off("balance", onBalance);
      socket.off("joined", onJoined);
      socket.off("error", onError);
      socket.off("gameStarted", onStarted);
      socket.off("gameFinished", onFinished);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect", onReconnect);
      socket.off("connect", join);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomIdParam, token, name, guest.id]);

  const act = (action, cardId) => {
    setActionBusy(true);
    getSocket().emit("playerAction", cardId ? { action, cardId } : { action });
  };

  const leave = () => {
    getSocket().emit("leaveRoom");
    navigate("/");
  };

  const copyLink = async () => {
    const link = `${window.location.origin}/game?room=${encodeURIComponent(room?.id || roomIdParam)}`;
    try {
      await navigator.clipboard.writeText(link);
      notify("Ссылка на комнату скопирована", "success");
    } catch {
      notify(`Код комнаты: ${room?.id || roomIdParam}`, "info");
    }
  };

  if (fatal) {
    return (
      <div className="card center-card">
        <h2>Не удалось войти</h2>
        <p className="muted">{fatal}</p>
        <Link to="/" className="btn btn-primary">
          На главную
        </Link>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="card center-card">
        <span className="spinner big" />
        <p className="muted">Подключаемся к комнате…</p>
      </div>
    );
  }

  const info = GAMES[room.gameType] || GAMES.blackjack;
  const me = room.players.find((player) => player.id === room.yourId);
  const isCreator = room.creatorId === room.yourId;
  const isMyTurn = room.currentTurn === room.yourId && room.status === "playing";

  return (
    <div className="game-screen">
      <div className="game-topbar card">
        <button type="button" className="icon-btn" onClick={leave} title="Выйти из комнаты">
          ←
        </button>
        <div className="game-title">
          <strong>
            {info.icon} {info.title}
          </strong>
          <span className="muted small">Комната {room.id}</span>
        </div>
        <div className="game-pills">
          <span className="chip">💰 {fmt(room.bet)}</span>
          <span className="chip">💳 {fmt(balance)}</span>
        </div>
        <button type="button" className="btn btn-ghost btn-small" onClick={leave}>
          Выйти
        </button>
      </div>

      {room.status === "waiting" ? (
        <section className="card center-card">
          <span className="hero-emoji">{info.icon}</span>
          <h2>Ожидание игроков</h2>
          <p className="muted small">Отправьте другу код комнаты — он сможет присоединиться.</p>
          <div className="room-code">{room.id}</div>

          <div className="waiting-players">
            {room.players.map((player) => (
              <span key={player.id} className={`player-tag${player.id === room.yourId ? " is-me" : ""}`}>
                {player.name}
                {player.connected === false ? " (offline)" : ""}
              </span>
            ))}
          </div>

          <p className="muted small">
            {!isCreator
              ? "Ждём, пока создатель начнёт игру."
              : room.players.length >= room.maxPlayers
                ? "Комната заполнена — можно начинать!"
                : room.players.length < 2
                  ? "Нужно минимум 2 игрока: позовите друга по коду или добавьте бота."
                  : "Можно начинать или добавить ещё бота."}
          </p>

          <div className="actions-row">
            {isCreator ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={room.players.length < 2}
                  onClick={() => getSocket().emit("startGame")}
                >
                  ▶ Начать игру
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={room.players.length >= room.maxPlayers}
                  onClick={() => getSocket().emit("addBot")}
                >
                  🤖 Добавить бота
                </button>
              </>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={copyLink}>
              📋 Скопировать ссылку
            </button>
          </div>
        </section>
      ) : null}

      {room.status === "playing" ? (
        <>
          <section className="card status-card">
            <strong>
              {room.gameType === "blackjack"
                ? isMyTurn
                  ? "Ваш ход: возьмите карту или остановитесь"
                  : `Ход игрока: ${nameOf(room, room.currentTurn)}`
                : null}
              {room.gameType === "dice"
                ? isMyTurn
                  ? "Ваш бросок!"
                  : `Бросает: ${nameOf(room, room.currentTurn)}`
                : null}
              {room.gameType === "durak"
                ? isMyTurn
                  ? "Ваш ход"
                  : `Ход: ${nameOf(room, room.currentTurn)}`
                : null}
            </strong>
            {room.gameType === "blackjack" && me ? (
              <span className="muted"> · Ваши очки: {me.score ?? "—"}</span>
            ) : null}
            {room.gameType === "dice" && me?.dice ? (
              <span className="muted"> · Вы выбросили {me.dice}</span>
            ) : null}
          </section>

          <PlayersGrid room={room} />

          {room.gameType === "blackjack" && isMyTurn ? (
            <div className="actions-row sticky-actions">
              <button type="button" className="btn btn-primary" onClick={() => act("hit")}>
                🃏 Взять карту
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => act("stand")}>
                ✋ Хватит
              </button>
            </div>
          ) : null}

          {room.gameType === "dice" ? (
            <section className="card center-card">
              <DiceStage room={room} />
              {isMyTurn && !me?.dice ? (
                <button
                  type="button"
                  className="btn btn-accent"
                  disabled={actionBusy}
                  onClick={() => act("roll")}
                >
                  {actionBusy ? <span className="spinner" /> : "🎲 Бросить кубик"}
                </button>
              ) : null}
            </section>
          ) : null}

          {room.gameType === "durak" ? (
            <DurakBoard
              room={room}
              me={me}
              isMyTurn={isMyTurn}
              actionBusy={actionBusy}
              act={act}
              notify={notify}
            />
          ) : null}
        </>
      ) : null}

      {room.status === "finished" ? (
        <section className="card center-card">
          <span className="hero-emoji">
            {room.winner?.length === 0 ? "🤝" : room.winner?.includes(room.yourId) ? "🏆" : "💔"}
          </span>
          <h2>
            {!room.winner?.length
              ? "Ничья"
              : room.winner.includes(room.yourId)
                ? "Вы победили!"
                : `Победил: ${room.winner.map((id) => nameOf(room, id)).join(", ")}`}
          </h2>

          <div className="results-list">
            {room.players.map((player) => {
              const result = room.results?.[player.id] || {};
              const outcome = result.outcome || "tie";
              const amount = Number(result.amount || 0);
              let detail = "";
              if (room.gameType === "blackjack") detail = `Очки: ${result.score ?? player.score ?? "—"}`;
              if (room.gameType === "dice") detail = `Кубик: ${result.dice ?? player.dice ?? "—"}`;
              if (room.gameType === "durak") detail = `Карт осталось: ${result.cardsLeft ?? player.handCount ?? 0}`;
              return (
                <div key={player.id} className={`result-row ${outcome}`}>
                  <span>
                    {player.name}
                    {player.id === room.yourId ? " (вы)" : ""}
                  </span>
                  <span className="muted">{detail}</span>
                  <strong className={amount > 0 ? "green" : amount < 0 ? "red" : ""}>
                    {OUTCOME[outcome] || "Возврат"}
                    {outcome === "bot" ? "" : ` ${amount > 0 ? "+" : ""}${fmt(amount)}`}
                  </strong>
                </div>
              );
            })}
          </div>

          <div className="actions-row">
            {isCreator ? (
              <button type="button" className="btn btn-primary" onClick={() => getSocket().emit("rematch")}>
                🔄 Играть ещё
              </button>
            ) : null}
            <Link to="/" className="btn btn-ghost">
              🏠 На главную
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DiceStage({ room }) {
  return (
    <div className="dice-stage">
      {room.players.map((player) => (
        <div
          key={player.id}
          className={`dice-lane${room.currentTurn === player.id && room.status === "playing" ? " is-turn" : ""}`}
        >
          <div className={`die${player.dice ? " rolled" : ""}`}>{player.dice || "?"}</div>
          <span className="muted small">{player.name}</span>
        </div>
      ))}
    </div>
  );
}

function DurakBoard({ room, me, isMyTurn, actionBusy, act, notify }) {
  const isAttacker = room.attacker === room.yourId;
  const isDefender = room.defender === room.yourId;
  const undefended = (room.table || []).some((pair) => !pair.defend);
  const trump = room.trump ? `${room.trump.name}${room.trump.suit}` : "—";
  const trumpRed = room.trump && ["♥", "♦"].includes(room.trump.suit);

  const hint = !isMyTurn
    ? `Ход: ${nameOf(room, room.currentTurn)}`
    : isAttacker
      ? (room.table || []).length
        ? "Выберите карту того же достоинства или нажмите «Бито»"
        : "Выберите карту для атаки"
      : isDefender
        ? "Выберите карту, чтобы отбиться, или возьмите карты"
        : "";

  const onCard = (cardId) => {
    if (!isMyTurn) {
      notify("Сейчас не ваш ход", "error");
      return;
    }
    if (isAttacker) act("attack", cardId);
    else if (isDefender) act("defend", cardId);
    else notify("Сейчас вы не атакуете и не отбиваетесь", "info");
  };

  return (
    <>
      <section className="card">
        <div className="table-meta">
          <span>
            Козырь: <strong className={trumpRed ? "red" : ""}>{trump}</strong>
          </span>
          <span>
            В колоде: <strong>{room.deckCount ?? 0}</strong>
          </span>
          <span>
            Атакует: <strong>{nameOf(room, room.attacker)}</strong>
          </span>
          <span>
            Отбивается: <strong>{nameOf(room, room.defender)}</strong>
          </span>
        </div>

        <div className="table-center">
          {(room.table || []).length ? (
            room.table.map((pair, index) => (
              <div className="table-pair" key={`${pair.attack?.id || index}`}>
                <Card card={pair.attack} />
                {pair.defend ? <Card card={pair.defend} /> : <div className="playing-card card-slot">·</div>}
              </div>
            ))
          ) : (
            <span className="muted">Кон пуст — атакуйте!</span>
          )}
        </div>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>🃏 Ваши карты</h2>
          <span className="muted small">{hint}</span>
        </div>
        <div className="cards-row">
          {(me?.hand || []).map((card) => (
            <button
              key={card.id}
              type="button"
              className="card-button"
              onClick={() => onCard(card.id)}
              aria-label={`${card.name}${card.suit}`}
            >
              <Card card={card} />
            </button>
          ))}
          {!me?.hand?.length ? <span className="muted small">Карт нет</span> : null}
        </div>

        <div className="actions-row">
          {isMyTurn && isAttacker && (room.table || []).length && !undefended ? (
            <button type="button" className="btn btn-primary" disabled={actionBusy} onClick={() => act("pass")}>
              ✅ Бито
            </button>
          ) : null}
          {isMyTurn && isDefender ? (
            <button type="button" className="btn btn-secondary" disabled={actionBusy} onClick={() => act("take")}>
              🫳 Взять карты
            </button>
          ) : null}
        </div>
      </section>
    </>
  );
}
