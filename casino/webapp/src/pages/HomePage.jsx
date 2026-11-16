import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useApp } from "../context/AppContext.jsx";
import { api } from "../lib/api.js";
import { GAMES, STATUS, fmt, guestIdentity, playerName, saveGuestName } from "../lib/format.js";
import { getSocket } from "../lib/socket.js";

function RoomCard({ room, onJoin }) {
  const info = GAMES[room.gameType] || GAMES.blackjack;
  return (
    <button type="button" className="room-card" onClick={() => onJoin(room.id)}>
      <div className="room-head">
        <strong>
          {info.icon} {info.title}
        </strong>
        <span className={`badge ${room.status}`}>{STATUS[room.status] || room.status}</span>
      </div>
      <div className="room-meta">
        <span>💰 {fmt(room.bet)}</span>
        <span>
          👥 {room.players.length}/{room.maxPlayers}
        </span>
      </div>
      <div className="room-players">
        {room.players.map((player) => (
          <span key={player.id} className="player-tag">
            {player.name}
          </span>
        ))}
      </div>
    </button>
  );
}

function AccountCard() {
  const { user, loginWithCode, logout, notify } = useApp();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [bot, setBot] = useState(null);

  useEffect(() => {
    api.anon("/api/bot").then(setBot).catch(() => {});
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      await loginWithCode(code.trim());
      setCode("");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return (
      <section className="card account-card" id="account">
        <div className="section-title">
          <h2>🔐 Ваш аккаунт</h2>
          <span className="badge approved">привязан</span>
        </div>
        <div className="account-grid">
          <div>
            <span className="muted small">Имя</span>
            <strong>{playerName(user)}</strong>
          </div>
          <div>
            <span className="muted small">ID в базе</span>
            <strong className="mono">{user.id}</strong>
          </div>
          <div>
            <span className="muted small">Кошелёк</span>
            <strong>💳 {fmt(user.balance)}</strong>
          </div>
          <div>
            <span className="muted small">Очки ⭐</span>
            <strong>{fmt(user.points)}</strong>
          </div>
        </div>
        <p className="muted small">
          Этот ID — ваш Telegram ID. Баланс общий с ботом: пополнение, вывод и ставки видны
          и на сайте, и в Telegram.
        </p>
        <button type="button" className="btn btn-ghost btn-small" onClick={logout}>
          Выйти из аккаунта
        </button>
      </section>
    );
  }

  return (
    <section className="card account-card" id="account">
      <div className="section-title">
        <h2>🔐 Вход по ID из Telegram</h2>
      </div>
      <ol className="steps">
        <li>
          Откройте бота{bot?.username ? <> — <a href={bot.url} target="_blank" rel="noreferrer">@{bot.username}</a></> : null} в Telegram.
        </li>
        <li>Нажмите «🌐 Войти на сайт» — бот пришлёт код и покажет ваш ID.</li>
        <li>Введите код ниже: сайт откроется под вашим аккаунтом и кошельком.</li>
      </ol>
      <form className="row-form" onSubmit={submit}>
        <input
          className="input code-input"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="КОД ИЗ TELEGRAM"
          maxLength={12}
          autoComplete="one-time-code"
          inputMode="text"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
          {busy ? <span className="spinner" /> : "Войти"}
        </button>
      </form>
      <p className="muted small">
        Без входа можно играть как гость — но баланс будет гостевым и не сохранится в боте.
      </p>
    </section>
  );
}

export default function HomePage() {
  const { token, user, notify } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const guest = useMemo(() => guestIdentity(), []);
  const [name, setName] = useState(user ? playerName(user) : guest.name);
  const [bet, setBet] = useState(100);
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [rooms, setRooms] = useState([]);
  const [busy, setBusy] = useState(false);
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    if (user) setName(playerName(user));
  }, [user]);

  // Переход по ссылке «Войти» с другой страницы: /#account
  useEffect(() => {
    if (location.hash !== "#account") return;
    const node = document.getElementById("account");
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash, user]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api.anon("/api/rooms");
        if (alive) setRooms(Array.isArray(data) ? data : []);
      } catch {
        /* сервер перезапускается */
      }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onJoined = (data) => navigate(`/game?room=${encodeURIComponent(data.roomId)}`);
    const onError = (data) => {
      setBusy(false);
      notify(data?.message || "Ошибка", "error");
    };
    socket.on("joined", onJoined);
    socket.on("error", onError);
    return () => {
      socket.off("joined", onJoined);
      socket.off("error", onError);
    };
  }, [navigate, notify]);

  const displayName = () => {
    const value = (name || "").trim().slice(0, 24) || guest.name;
    saveGuestName(value);
    return value;
  };

  const createRoom = (gameType) => {
    if (busy) return;
    setBusy(true);
    getSocket().emit("join", {
      sessionToken: token || undefined,
      userId: guest.id,
      userName: displayName(),
      gameType,
      bet: Math.max(1, Number(bet) || 100),
      maxPlayers: Math.min(4, Math.max(2, Number(maxPlayers) || 2)),
    });
  };

  const joinRoom = (roomId) => {
    if (busy) return;
    const id = String(roomId || "").trim().toUpperCase();
    if (!id) {
      notify("Введите код комнаты", "error");
      return;
    }
    setBusy(true);
    getSocket().emit("join", {
      sessionToken: token || undefined,
      userId: guest.id,
      userName: displayName(),
      roomId: id,
    });
  };

  const openRooms = rooms.filter((room) => room.status !== "finished");

  return (
    <div className="stack">
      <section className="hero">
        <span className="eyebrow">🎮 Онлайн-казино на виртуальные монеты</span>
        <h1>
          Играй с друзьями
          <br />
          <span className="gradient-text">в реальном времени</span>
        </h1>
        <p className="muted">
          {user ? `Вы вошли как ${playerName(user)}` : "Войдите по коду из Telegram, чтобы играть со своим балансом"}{" "}
          · {fmt(user?.balance)} 💳
        </p>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>🎲 Новая игра</h2>
        </div>
        <div className="game-buttons">
          {Object.entries(GAMES).map(([key, game]) => (
            <button
              key={key}
              type="button"
              className={`game-button game-${key}`}
              disabled={busy}
              onClick={() => createRoom(key)}
            >
              <span className="game-icon">{game.icon}</span>
              <span>{game.title}</span>
            </button>
          ))}
        </div>

        <div className="fields-grid">
          <label className="field">
            <span>Ваше имя</span>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={24}
              placeholder="Игрок"
            />
          </label>
          <label className="field">
            <span>Ставка 💰</span>
            <input
              className="input"
              type="number"
              min={1}
              value={bet}
              onChange={(event) => setBet(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Игроков</span>
            <select
              className="input"
              value={maxPlayers}
              onChange={(event) => setMaxPlayers(event.target.value)}
            >
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
        </div>
        <p className="muted small">
          Внутри комнаты можно нажать «🤖 Добавить бота» и играть одному.
        </p>
      </section>

      <AccountCard />

      <section className="card">
        <div className="section-title">
          <h2>🔥 Активные комнаты</h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => window.location.reload()}>
            Обновить
          </button>
        </div>
        {openRooms.length ? (
          <div className="rooms-grid">
            {openRooms.map((room) => (
              <RoomCard key={room.id} room={room} onJoin={joinRoom} />
            ))}
          </div>
        ) : (
          <p className="muted">Комнат пока нет — создайте свою.</p>
        )}
      </section>

      <section className="card">
        <div className="section-title">
          <h2>⚡ Быстрый вход</h2>
        </div>
        <form
          className="row-form"
          onSubmit={(event) => {
            event.preventDefault();
            joinRoom(joinCode);
          }}
        >
          <input
            className="input"
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="Код комнаты, например A1B2C3"
            maxLength={6}
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Войти
          </button>
        </form>
      </section>

      <section className="quick-links">
        <Link to="/stats" className="quick-link">
          📊 <span>Топы и статистика</span>
        </Link>
        <Link to="/donate" className="quick-link">
          💳 <span>Пополнить баланс</span>
        </Link>
      </section>
    </div>
  );
}
