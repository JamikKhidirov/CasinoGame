/* 🎰 Клиент главной страницы */
const socket = io();

const GAME_INFO = {
  blackjack: { icon: "🃏", title: "Блэкджек 21" },
  durak: { icon: "♠️", title: "Дурак" },
  dice: { icon: "🎲", title: "Кости" },
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

const app = {
  currentUserId: null,
  currentUserName: null,
  joining: false,

  init() {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    const savedId = localStorage.getItem("casino_player_id");
    const savedName = localStorage.getItem("casino_player_name");

    if (tgUser?.id) {
      this.currentUserId = String(tgUser.id);
      this.currentUserName = tgUser.first_name || tgUser.username || `Игрок_${tgUser.id}`;
    } else if (savedId && /^-?\d+$/.test(savedId)) {
      this.currentUserId = savedId;
      this.currentUserName = savedName || `Игрок_${Math.floor(Math.random() * 1000)}`;
    } else {
      // Гостевой ID отрицательный, чтобы не пересекаться с Telegram ID.
      this.currentUserId = String(-Math.floor(100000000 + Math.random() * 899999999));
      this.currentUserName = savedName || `Игрок_${Math.floor(Math.random() * 1000)}`;
      localStorage.setItem("casino_player_id", this.currentUserId);
    }
    localStorage.setItem("casino_player_name", this.currentUserName);

    const nameInput = document.getElementById("playerNameInput");
    if (nameInput) nameInput.value = this.currentUserName;

    socket.on("connect", () => console.log("Socket connected"));
    socket.on("disconnect", () => this.showNotification("Соединение потеряно. Переподключение…", "error"));

    socket.on("joined", (data) => {
      this.joining = false;
      localStorage.setItem("casino_player_id", String(data.userId));
      const url = `/game.html?room=${encodeURIComponent(data.roomId)}`
        + `&user=${encodeURIComponent(data.userId)}`
        + `&name=${encodeURIComponent(this.currentUserName)}`;
      window.location.href = url;
    });

    socket.on("error", (data) => {
      this.joining = false;
      this.showNotification(data?.message || "Ошибка", "error");
    });

    socket.on("adminMessage", (data) => {
      this.showNotification(data.message, data.type || "info");
    });

    this.refreshRooms();
    setInterval(() => this.refreshRooms(), 5000);
    this.loadBalance();
  },

  async loadBalance() {
    try {
      const res = await fetch(`/api/user/${encodeURIComponent(this.currentUserId)}`);
      if (!res.ok) return;
      const user = await res.json();
      const el = document.getElementById("tma-balance");
      if (el) el.textContent = `💳 ${user.balance ?? 0}`;
    } catch (_) {
      /* ignore */
    }
  },

  createRoom(gameType) {
    if (this.joining) return;
    const nameInput = document.getElementById("playerNameInput");
    const betInput = document.getElementById("betInput");
    const maxInput = document.getElementById("maxPlayersInput");
    const name = (nameInput?.value || this.currentUserName || "Игрок").trim().slice(0, 24);
    const bet = Math.max(1, Number.parseInt(betInput?.value, 10) || 100);
    const maxPlayers = Math.min(4, Math.max(2, Number.parseInt(maxInput?.value, 10) || 4));

    this.currentUserName = name;
    localStorage.setItem("casino_player_name", name);
    this.joining = true;
    socket.emit("join", {
      userId: this.currentUserId,
      userName: name,
      gameType,
      bet,
      maxPlayers,
    });
  },

  joinRoom() {
    if (this.joining) return;
    const roomId = document.getElementById("roomJoinInput").value.trim().toUpperCase();
    const nameInput = document.getElementById("playerNameInput");
    const name = (nameInput?.value || this.currentUserName || "Игрок").trim().slice(0, 24);
    if (!roomId) {
      this.showNotification("Введите ID комнаты", "error");
      return;
    }
    this.currentUserName = name;
    localStorage.setItem("casino_player_name", name);
    this.joining = true;
    socket.emit("join", {
      userId: this.currentUserId,
      userName: name,
      roomId,
    });
  },

  joinRoomById(roomId) {
    if (this.joining) return;
    const nameInput = document.getElementById("playerNameInput");
    const name = (nameInput?.value || this.currentUserName || "Игрок").trim().slice(0, 24);
    this.currentUserName = name;
    localStorage.setItem("casino_player_name", name);
    this.joining = true;
    socket.emit("join", {
      userId: this.currentUserId,
      userName: name,
      roomId,
    });
  },

  async refreshRooms() {
    try {
      const res = await fetch("/api/rooms");
      const rooms = await res.json();
      this.renderRoomsList(rooms);
    } catch (err) {
      console.error("Не удалось загрузить комнаты", err);
    }
  },

  renderRoomsList(rooms) {
    const grid = document.getElementById("roomsGrid");
    if (!grid) return;
    const open = (rooms || []).filter((room) => room.status !== "finished");
    if (!open.length) {
      grid.innerHTML = '<div class="empty-rooms">Комнат пока нет. Создай свою!</div>';
      return;
    }
    grid.innerHTML = open.map((room) => {
      const info = GAME_INFO[room.gameType] || GAME_INFO.blackjack;
      const statusText = room.status === "waiting" ? "Ожидание" : "Игра идёт";
      return `<div class="room-card glass-card" data-room="${esc(room.id)}">
        <h3>${info.icon} ${esc(info.title)}
          <span class="room-status ${room.status === "waiting" ? "waiting" : "playing"}">${statusText}</span>
        </h3>
        <div class="room-details">
          <span>💰 Ставка: ${esc(room.bet)}</span>
          <span>👥 ${room.players.length}/${room.maxPlayers}</span>
        </div>
        <div class="room-players">
          ${room.players.map((p) => `<span class="player-badge">${esc(p.name)}</span>`).join("")}
        </div>
      </div>`;
    }).join("");
    grid.querySelectorAll("[data-room]").forEach((card) => {
      card.addEventListener("click", () => this.joinRoomById(card.dataset.room));
    });
  },

  showNotification(message, type = "info") {
    const notif = document.createElement("div");
    notif.className = `notification ${type}`;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 4000);
  },
};

document.addEventListener("DOMContentLoaded", () => app.init());

// Нужно для inline-обработчиков onclick в index.html
window.app = app;
