/* 🛠 Клиент админ-панели */
const socket = io();
const state = { authed: false };

const $ = (id) => document.getElementById(id);

const els = {
  connStatus: $("connStatus"),
  loginCard: $("loginCard"),
  loginForm: $("loginForm"),
  passwordInput: $("passwordInput"),
  loginError: $("loginError"),
  dashboard: $("dashboard"),
  logoutBtn: $("logoutBtn"),
  statUsers: $("statUsers"),
  statRooms: $("statRooms"),
  statBalance: $("statBalance"),
  statGames: $("statGames"),
  roomsBody: $("roomsBody"),
  txBody: $("txBody"),
  refreshBtn: $("refreshBtn"),
  refreshTxBtn: $("refreshTxBtn"),
  balanceForm: $("balanceForm"),
  balanceUserId: $("balanceUserId"),
  balanceDelta: $("balanceDelta"),
  balanceReason: $("balanceReason"),
  broadcastForm: $("broadcastForm"),
  broadcastText: $("broadcastText"),
};

const GAME_NAMES = { blackjack: "🃏 Блэкджек", durak: "♠️ Дурак", dice: "🎲 Кости" };
const STATUS_NAMES = { waiting: "Ожидание", playing: "Игра идёт", finished: "Завершена" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function notify(message, type = "info") {
  const node = document.createElement("div");
  node.className = `notification ${type}`;
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 4000);
}

function fmtDate(seconds) {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString("ru-RU");
}

function setAuthed(ok) {
  state.authed = ok;
  els.loginCard.hidden = ok;
  els.dashboard.hidden = !ok;
  els.logoutBtn.hidden = !ok;
  if (ok) {
    socket.emit("adminStats");
    socket.emit("adminTransactions");
  }
}

socket.on("connect", () => {
  els.connStatus.textContent = "● онлайн";
  els.connStatus.classList.add("online");
  if (state.authed) {
    socket.emit("adminStats");
    socket.emit("adminTransactions");
  }
});

socket.on("disconnect", () => {
  els.connStatus.textContent = "● нет связи";
  els.connStatus.classList.remove("online");
});

socket.on("adminAuth", (data) => {
  if (data.success) {
    els.loginError.textContent = "";
    els.passwordInput.value = "";
    setAuthed(true);
    notify("Добро пожаловать в админ-панель", "success");
  } else {
    els.loginError.textContent = data.message || "Неверный пароль";
  }
});

socket.on("adminStats", (data) => {
  els.statUsers.textContent = data.totalUsers ?? 0;
  els.statRooms.textContent = data.totalRooms ?? 0;
  els.statBalance.textContent = data.totalBalance ?? 0;
  els.statGames.textContent = data.totalGames ?? 0;

  const rooms = data.roomsList || [];
  if (!rooms.length) {
    els.roomsBody.innerHTML = '<tr><td colspan="6" class="muted">Активных комнат нет</td></tr>';
  } else {
    els.roomsBody.innerHTML = rooms.map((room) => `
      <tr>
        <td><code>${esc(room.id)}</code></td>
        <td>${esc(GAME_NAMES[room.gameType] || room.gameType)}</td>
        <td>💰 ${esc(room.bet)}</td>
        <td>${room.players.length}/${room.maxPlayers}<br><span class="muted small">${room.players.map((p) => esc(p.name)).join(", ")}</span></td>
        <td><span class="status-dot ${esc(room.status)}">${esc(STATUS_NAMES[room.status] || room.status)}</span></td>
        <td><button class="btn btn-outline btn-small" data-close-room="${esc(room.id)}">Закрыть</button></td>
      </tr>
    `).join("");
    els.roomsBody.querySelectorAll("[data-close-room]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!confirm(`Закрыть комнату ${btn.dataset.closeRoom}? Ставки будут возвращены.`)) return;
        socket.emit("adminCloseRoom", { roomId: btn.dataset.closeRoom });
      });
    });
  }
});

socket.on("adminTransactions", (rows) => {
  if (!rows || !rows.length) {
    els.txBody.innerHTML = '<tr><td colspan="6" class="muted">Нет операций</td></tr>';
    return;
  }
  els.txBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${esc(row.id)}</td>
      <td>${esc(row.name || row.user_id)}</td>
      <td class="${row.amount > 0 ? "green-text" : "red-text"}">${row.amount > 0 ? "+" : ""}${esc(row.amount)}</td>
      <td>${esc(row.type)}</td>
      <td>${esc(row.description || "—")}</td>
      <td class="muted small">${esc(fmtDate(row.created_at))}</td>
    </tr>
  `).join("");
});

socket.on("adminActionResult", (data) => {
  notify(data.message || "Готово", data.ok ? "success" : "error");
  socket.emit("adminStats");
  socket.emit("adminTransactions");
});

socket.on("adminMessage", (data) => {
  notify(data.message || "Сообщение", data.type || "info");
});

els.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  els.loginError.textContent = "Проверяем…";
  socket.emit("adminLogin", { password: els.passwordInput.value });
});

els.logoutBtn.addEventListener("click", () => {
  window.location.reload();
});

els.refreshBtn.addEventListener("click", () => socket.emit("adminStats"));
els.refreshTxBtn.addEventListener("click", () => socket.emit("adminTransactions"));

els.balanceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const userId = els.balanceUserId.value.trim();
  const delta = Number.parseInt(els.balanceDelta.value, 10);
  if (!userId || !Number.isFinite(delta) || delta === 0) {
    notify("Укажите ID и ненулевую сумму", "error");
    return;
  }
  socket.emit("adminAdjustBalance", {
    userId,
    delta,
    reason: els.balanceReason.value.trim() || "Корректировка админ-панелью",
  });
  els.balanceDelta.value = "";
  els.balanceReason.value = "";
});

els.broadcastForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = els.broadcastText.value.trim();
  if (!message) return;
  socket.emit("adminBroadcast", { message });
  els.broadcastText.value = "";
  notify("Рассылка отправлена", "success");
});
