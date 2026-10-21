const socket = io();
const app = {
  currentRoomId: null,
  currentUserId: null,
  currentUserName: null,

  init() {
    // Generate random user name if not set
    const savedName = localStorage.getItem("casino_player_name");
    const savedId = localStorage.getItem("casino_player_id");
    
    if (savedId) {
      this.currentUserId = savedId;
    } else {
      this.currentUserId = "user_" + Math.floor(Math.random() * 100000);
      localStorage.setItem("casino_player_id", this.currentUserId);
    }
    
    this.currentUserName = savedName || "Игрок_" + Math.floor(Math.random() * 1000);
    document.getElementById("playerNameInput").value = this.currentUserName;

    socket.on("connect", () => {
      console.log("Connected to server");
    });

    socket.on("disconnect", () => {
      this.showNotification("Соединение потеряно. Переподключение...", "error");
    });

    socket.on("joined", (data) => {
      this.currentRoomId = data.roomId;
      this.currentUserId = data.userId;
      localStorage.setItem("casino_player_id", this.currentUserId);
      window.location.href = `/game.html?room=${data.roomId}&user=${data.userId}&name=${encodeURIComponent(this.currentUserName)}`;
    });

    socket.on("roomUpdated", (room) => {
      this.renderRooms(room);
    });

    socket.on("error", (data) => {
      this.showNotification(data.message || "Ошибка", "error");
    });

    socket.on("playerLeft", (data) => {
      this.showNotification(`Игрок ${data.userId} покинул комнату`, "info");
    });

    socket.on("adminMessage", (data) => {
      this.showNotification(data.message, data.type);
    });

    socket.on("gameStarted", (data) => {
      this.showNotification(`Игра開始лась: ${data.gameType}`, "success");
    });

    this.refreshRooms();
  },

  createRoom(gameType) {
    const name = document.getElementById("playerNameInput").value || "Игрок";
    this.currentUserName = name;
    localStorage.setItem("casino_player_name", name);

    socket.emit("join", {
      userId: this.currentUserId,
      userName: name,
      gameType: gameType,
      bet: 100,
      maxPlayers: 4,
    });
  },

  joinRoom() {
    const roomId = document.getElementById("roomJoinInput").value.trim().toUpperCase();
    const name = document.getElementById("playerNameInput").value || "Игрок";
    this.currentUserName = name;
    localStorage.setItem("casino_player_name", name);

    if (!roomId) {
      this.showNotification("Введите ID комнаты", "error");
      return;
    }

    socket.emit("join", {
      userId: this.currentUserId,
      userName: name,
      roomId: roomId,
    });
  },

  refreshRooms() {
    fetch("/api/rooms")
      .then(r => r.json())
      .then(rooms => {
        this.renderRoomsList(rooms);
      })
      .catch(err => {
        console.error("Failed to fetch rooms", err);
      });
  },

  renderRoomsList(rooms) {
    const grid = document.getElementById("roomsGrid");
    if (!grid) return;
    
    if (!rooms || rooms.length === 0) {
      grid.innerHTML = '<div class="empty-rooms">Комнат пока нет. Создай свою!</div>';
      return;
    }

    grid.innerHTML = rooms.map(room => `
      <div class="room-card glass-card" onclick="app.joinRoomById('${room.id}')">
        <h3>${room.gameType === 'blackjack' ? '🃏' : '♠️'} ${room.gameType}
          <span class="room-status">${room.status === 'waiting' ? 'Ожидание' : 'Игра идёт'}</span>
        </h3>
        <div class="room-details">
          <span>💰 Ставка: ${room.bet}</span>
          <span>👥 ${room.players.length}/${room.maxPlayers}</span>
        </div>
        <div class="room-players">
          ${room.players.map(p => `<span class="player-badge">${p.name}</span>`).join('')}
        </div>
      </div>
    `).join('');
  },

  renderRooms(room) {
    // Single room update - refresh all
    this.refreshRooms();
  },

  joinRoomById(roomId) {
    const name = document.getElementById("playerNameInput").value || "Игрок";
    this.currentUserName = name;
    localStorage.setItem("casino_player_name", name);

    socket.emit("join", {
      userId: this.currentUserId,
      userName: name,
      roomId: roomId,
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

// Initialize on load
document.addEventListener("DOMContentLoaded", () => app.init());
