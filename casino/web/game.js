/* 🎰 Клиент игровой комнаты */
const socket = io();

const GAME_INFO = {
  blackjack: { icon: "🃏", title: "Блэкджек 21" },
  durak: { icon: "♠️", title: "Дурак" },
  dice: { icon: "🎲", title: "Кости" },
};

const params = new URLSearchParams(window.location.search);
const state = {
  roomId: (params.get("room") || "").toUpperCase(),
  userId: null,
  userName: params.get("name") || "",
  room: null,
  isCreator: false,
  balance: 0,
  joinedOnce: false,
};

const els = {
  backBtn: document.getElementById("backBtn"),
  leaveBtn: document.getElementById("leaveBtn"),
  gameIcon: document.getElementById("gameIcon"),
  gameTitle: document.getElementById("gameTitle"),
  roomCode: document.getElementById("roomCode"),
  betPill: document.getElementById("betPill"),
  balancePill: document.getElementById("balancePill"),
  waitingPanel: document.getElementById("waitingPanel"),
  playPanel: document.getElementById("playPanel"),
  finishedPanel: document.getElementById("finishedPanel"),
  roomCodeBig: document.getElementById("roomCodeBig"),
  waitingPlayers: document.getElementById("waitingPlayers"),
  waitingHint: document.getElementById("waitingHint"),
  startBtn: document.getElementById("startBtn"),
  copyBtn: document.getElementById("copyBtn"),
  statusBanner: document.getElementById("statusBanner"),
  playersGrid: document.getElementById("playersGrid"),
  tableArea: document.getElementById("tableArea"),
  tableMeta: document.getElementById("tableMeta"),
  tableCenter: document.getElementById("tableCenter"),
  myHandWrap: document.getElementById("myHandWrap"),
  myHand: document.getElementById("myHand"),
  myHandHint: document.getElementById("myHandHint"),
  playActions: document.getElementById("playActions"),
  finishEmoji: document.getElementById("finishEmoji"),
  finishTitle: document.getElementById("finishTitle"),
  resultsList: document.getElementById("resultsList"),
  rematchBtn: document.getElementById("rematchBtn"),
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function getTelegramUser() {
  return window.Telegram?.WebApp?.initDataUnsafe?.user || null;
}

function initIdentity() {
  const tg = getTelegramUser();
  if (tg?.id) {
    state.userId = String(tg.id);
    state.userName = state.userName || tg.first_name || tg.username || `Игрок_${tg.id}`;
    return;
  }
  let savedId = localStorage.getItem("casino_player_id");
  if (!savedId || !/^-?\d+$/.test(savedId)) {
    savedId = String(-Math.floor(100000000 + Math.random() * 899999999));
    localStorage.setItem("casino_player_id", savedId);
  }
  state.userId = savedId;
  state.userName = state.userName
    || localStorage.getItem("casino_player_name")
    || `Игрок_${Math.floor(Math.random() * 1000)}`;
  localStorage.setItem("casino_player_name", state.userName);
}

function notify(message, type = "info") {
  const node = document.createElement("div");
  node.className = `notification ${type}`;
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 4000);
}

function cardHtml(card, hidden = false) {
  if (hidden || !card) {
    return '<div class="card card-back" aria-label="Закрытая карта"><span>✦</span></div>';
  }
  const red = card.suit === "♥" || card.suit === "♦";
  return `<div class="card ${red ? "red" : ""}" data-card="${esc(card.id)}">
    <span class="card-rank">${esc(card.name)}</span>
    <span class="card-suit">${esc(card.suit)}</span>
  </div>`;
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

function renderPlayers(room) {
  const finished = room.status === "finished";
  els.playersGrid.innerHTML = room.players.map((player) => {
    const isMe = player.id === room.yourId;
    const isTurn = room.currentTurn === player.id && room.status === "playing";
    const score = player.score !== null && player.score !== undefined
      ? `<span class="score-badge">${player.score}</span>`
      : "";
    let hand = "";
    if (room.gameType === "blackjack" || room.gameType === "durak") {
      const cards = [];
      const visible = player.hand || [];
      for (const card of visible) cards.push(cardHtml(card));
      const hiddenCount = Math.max(0, (player.handCount || 0) - visible.length);
      for (let i = 0; i < hiddenCount; i++) cards.push(cardHtml(null, true));
      if (cards.length) hand = `<div class="cards-row mini">${cards.join("")}</div>`;
    }
    if (room.gameType === "dice") {
      hand = `<div class="die ${player.dice ? "rolled" : ""}">${player.dice || "?"}</div>`;
    }
    return `<div class="player-card glass-card ${isMe ? "is-me" : ""} ${isTurn ? "is-turn" : ""} ${player.connected === false ? "offline" : ""}">
      <div class="player-card-head">
        <span class="player-name">${isMe ? "🫵 " : ""}${esc(player.name)}</span>
        ${score}
      </div>
      <div class="player-status">${esc(playerStatus(room, player))}</div>
      ${hand}
      ${player.balance !== undefined ? `<div class="player-balance muted small">💳 ${player.balance}</div>` : ""}
    </div>`;
  }).join("");
}

function renderWaiting(room) {
  els.waitingPanel.hidden = false;
  els.playPanel.hidden = true;
  els.finishedPanel.hidden = true;

  els.roomCodeBig.textContent = room.id;
  els.waitingPlayers.innerHTML = room.players.map((player) => `
    <div class="player-badge ${player.id === room.yourId ? "is-me" : ""}">
      ${esc(player.name)}${player.connected === false ? " (offline)" : ""}
    </div>
  `).join("");

  const isCreator = room.creatorId === room.yourId || state.isCreator;
  els.startBtn.hidden = !(isCreator && room.players.length >= 2);
  els.waitingHint.textContent = !isCreator
    ? "Ждём, пока создатель начнёт игру."
    : room.players.length < 2
      ? "Нужно минимум 2 игрока. Отправьте код другу."
      : "Можно начинать!";
}

function renderPlay(room) {
  els.waitingPanel.hidden = true;
  els.playPanel.hidden = false;
  els.finishedPanel.hidden = true;

  renderPlayers(room);
  els.playActions.innerHTML = "";

  if (room.gameType === "blackjack") {
    els.tableArea.hidden = true;
    els.myHandWrap.hidden = true;
    renderBlackjack(room);
  } else if (room.gameType === "durak") {
    els.tableArea.hidden = false;
    els.myHandWrap.hidden = false;
    renderDurak(room);
  } else {
    els.tableArea.hidden = true;
    els.myHandWrap.hidden = true;
    renderDice(room);
  }
}

function renderBlackjack(room) {
  const me = room.players.find((p) => p.id === room.yourId);
  const isMyTurn = room.currentTurn === room.yourId && room.status === "playing";
  els.statusBanner.textContent = isMyTurn
    ? "Ваш ход: возьмите карту или остановитесь"
    : `Ход игрока: ${esc(nameOf(room, room.currentTurn))}`;
  els.playActions.innerHTML = isMyTurn
    ? `<button class="btn btn-primary" data-action="hit">🃏 Взять карту</button>
       <button class="btn btn-secondary" data-action="stand">✋ Хватит</button>`
    : "";
  els.playActions.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => act(btn.dataset.action));
  });
  if (me) {
    els.statusBanner.textContent += ` · Ваши очки: ${me.score ?? "—"}`;
  }
}

function renderDurak(room) {
  const me = room.players.find((p) => p.id === room.yourId);
  const trump = room.trump ? `${room.trump.name}${room.trump.suit}` : "—";
  els.tableMeta.innerHTML = `
    <span>Козырь: <strong class="${room.trump && ["♥","♦"].includes(room.trump.suit) ? "red-text" : ""}">${esc(trump)}</strong></span>
    <span>В колоде: <strong>${room.deckCount ?? 0}</strong></span>
    <span>Атакует: <strong>${esc(nameOf(room, room.attacker))}</strong></span>
    <span>Отбивается: <strong>${esc(nameOf(room, room.defender))}</strong></span>
  `;

  const pairs = (room.table || []).map((pair) => `
    <div class="table-pair">
      ${cardHtml(pair.attack)}
      ${pair.defend ? cardHtml(pair.defend) : '<div class="card card-slot">·</div>'}
    </div>
  `).join("");
  els.tableCenter.innerHTML = pairs || '<div class="muted">Кон пуст — атакуйте!</div>';

  if (me) {
    els.myHand.innerHTML = (me.hand || []).map((card) => cardHtml(card)).join("");
  } else {
    els.myHand.innerHTML = "";
  }

  const isMyTurn = room.currentTurn === room.yourId && room.status === "playing";
  const isAttacker = room.attacker === room.yourId;
  const isDefender = room.defender === room.yourId;
  const undefended = (room.table || []).some((pair) => !pair.defend);

  if (!isMyTurn) {
    els.myHandHint.textContent = `Ход: ${nameOf(room, room.currentTurn)}`;
  } else if (isAttacker) {
    els.myHandHint.textContent = (room.table || []).length
      ? "Выберите карту того же достоинства или нажмите «Бито»"
      : "Выберите карту для атаки";
  } else if (isDefender) {
    els.myHandHint.textContent = "Выберите карту, чтобы отбиться, или возьмите карты";
  }

  const buttons = [];
  if (isMyTurn && isAttacker && (room.table || []).length && !undefended) {
    buttons.push('<button class="btn btn-primary" data-durak="pass">✅ Бито</button>');
  }
  if (isMyTurn && isDefender) {
    buttons.push('<button class="btn btn-secondary" data-durak="take">🫳 Взять карты</button>');
  }
  els.playActions.innerHTML = buttons.join("");
  els.playActions.querySelectorAll("[data-durak]").forEach((btn) => {
    btn.addEventListener("click", () => act(btn.dataset.durak));
  });

  els.myHand.querySelectorAll(".card[data-card]").forEach((cardEl) => {
    cardEl.addEventListener("click", () => {
      if (!isMyTurn) {
        notify("Сейчас не ваш ход", "error");
        return;
      }
      const cardId = cardEl.dataset.card;
      if (isAttacker) act("attack", cardId);
      else if (isDefender) act("defend", cardId);
      else notify("Сейчас вы не атакуете и не отбиваетесь", "info");
    });
  });
}

function renderDice(room) {
  const isMyTurn = room.currentTurn === room.yourId && room.status === "playing";
  const me = room.players.find((p) => p.id === room.yourId);
  els.statusBanner.textContent = isMyTurn
    ? "Ваш бросок!"
    : `Бросает: ${esc(nameOf(room, room.currentTurn))}`;
  if (me && me.dice) {
    els.statusBanner.textContent += ` · Вы выбросили ${me.dice}`;
  }
  els.playActions.innerHTML = isMyTurn
    ? '<button class="btn btn-accent" data-dice="roll">🎲 Бросить кубик</button>'
    : "";
  const btn = els.playActions.querySelector("[data-dice]");
  if (btn) {
    btn.addEventListener("click", () => {
      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span>';
      act("roll");
    });
  }
}

function nameOf(room, userId) {
  if (!userId) return "—";
  const player = room.players.find((p) => p.id === userId);
  return player ? player.name : "—";
}

function renderFinished(room) {
  els.waitingPanel.hidden = true;
  els.playPanel.hidden = true;
  els.finishedPanel.hidden = false;

  const winners = room.winner || [];
  const iWon = winners.includes(room.yourId);
  els.finishEmoji.textContent = winners.length === 0 ? "🤝" : iWon ? "🏆" : "💔";
  els.finishTitle.textContent = winners.length === 0
    ? "Ничья / без победителя"
    : iWon
      ? "Вы победили!"
      : `Победил: ${winners.map((id) => nameOf(room, id)).join(", ")}`;

  els.resultsList.innerHTML = room.players.map((player) => {
    const result = room.results?.[player.id] || {};
    const outcome = result.outcome || "—";
    const amount = Number(result.amount || 0);
    const amountText = amount > 0 ? `+${amount}` : amount < 0 ? `${amount}` : "0";
    const outcomeText = outcome === "win" ? "Победа" : outcome === "lose" ? "Проигрыш" : "Возврат";
    let detail = "";
    if (room.gameType === "blackjack") detail = `Очки: ${result.score ?? player.score ?? "—"}`;
    if (room.gameType === "dice") detail = `Кубик: ${result.dice ?? player.dice ?? "—"}`;
    if (room.gameType === "durak") detail = `Карт осталось: ${result.cardsLeft ?? player.handCount ?? 0}`;
    return `<div class="result-row ${outcome}">
      <span>${esc(player.name)}${player.id === room.yourId ? " (вы)" : ""}</span>
      <span class="muted">${esc(detail)}</span>
      <strong class="${amount > 0 ? "green-text" : amount < 0 ? "red-text" : ""}">${outcomeText} ${amountText}</strong>
    </div>`;
  }).join("");

  els.rematchBtn.hidden = room.creatorId !== room.yourId;
}

function render() {
  const room = state.room;
  if (!room) return;

  const info = GAME_INFO[room.gameType] || GAME_INFO.blackjack;
  els.gameIcon.textContent = info.icon;
  els.gameTitle.textContent = info.title;
  els.roomCode.textContent = `Комната ${room.id}`;
  els.betPill.textContent = `💰 ${room.bet}`;
  els.roomCodeBig.textContent = room.id;

  const me = room.players.find((p) => p.id === (room.yourId || state.userId));
  if (me && Number.isFinite(me.balance)) state.balance = me.balance;
  els.balancePill.textContent = `💳 ${state.balance}`;

  if (room.status === "waiting") renderWaiting(room);
  else if (room.status === "finished") renderFinished(room);
  else renderPlay(room);
}

function act(action, cardId) {
  socket.emit("playerAction", { action, cardId });
}

/* ---------------------------- socket ---------------------------- */
socket.on("connect", () => {
  socket.emit("join", {
    userId: state.userId,
    userName: state.userName,
    roomId: state.roomId,
  });
});

socket.on("joined", (data) => {
  state.joinedOnce = true;
  state.roomId = data.roomId;
  state.userId = String(data.userId);
  state.isCreator = Boolean(data.isCreator);
  localStorage.setItem("casino_player_id", state.userId);
  localStorage.setItem("casino_player_name", state.userName);
  const url = new URL(window.location.href);
  url.searchParams.set("room", data.roomId);
  url.searchParams.set("user", data.userId);
  url.searchParams.set("name", state.userName);
  window.history.replaceState({}, "", url);
});

socket.on("roomUpdated", (room) => {
  state.room = room;
  if (room.yourId) state.userId = String(room.yourId);
  render();
});

socket.on("balance", (data) => {
  if (Number.isFinite(data.balance)) {
    state.balance = data.balance;
    els.balancePill.textContent = `💳 ${state.balance}`;
  }
});

socket.on("gameStarted", ({ gameType }) => {
  const info = GAME_INFO[gameType] || GAME_INFO.blackjack;
  notify(`Игра началась: ${info.title}`, "success");
});

socket.on("gameFinished", ({ winner }) => {
  if (Array.isArray(winner) && winner.includes(state.userId)) {
    notify("🏆 Вы победили!", "success");
  }
});

socket.on("error", (data) => {
  notify(data?.message || "Ошибка", "error");
  if (!state.joinedOnce && /не найдена|началась|переполнена/i.test(data?.message || "")) {
    setTimeout(() => { window.location.href = "/"; }, 1500);
  }
});

socket.on("disconnect", () => {
  notify("Соединение потеряно. Переподключаемся…", "error");
});

socket.io.on("reconnect", () => {
  notify("Соединение восстановлено", "success");
});

/* ---------------------------- UI events ------------------------- */
els.startBtn.addEventListener("click", () => socket.emit("startGame"));
els.rematchBtn.addEventListener("click", () => socket.emit("rematch"));
els.copyBtn.addEventListener("click", async () => {
  const link = `${window.location.origin}/game.html?room=${encodeURIComponent(state.roomId)}`;
  try {
    await navigator.clipboard.writeText(link);
    notify("Ссылка на комнату скопирована", "success");
  } catch (_) {
    notify(`Код комнаты: ${state.roomId}`, "info");
  }
});

function leave() {
  socket.emit("leaveRoom");
  setTimeout(() => { window.location.href = "/"; }, 120);
}
els.leaveBtn.addEventListener("click", leave);
els.backBtn.addEventListener("click", (event) => {
  event.preventDefault();
  leave();
});

/* ---------------------------- старт ------------------------------ */
if (!state.roomId) {
  window.location.href = "/";
} else {
  initIdentity();
  if (window.Telegram?.WebApp) {
    const twa = window.Telegram.WebApp;
    twa.ready();
    twa.expand();
    twa.setHeaderColor("#0f172a");
    twa.setBackgroundColor("#0f172a");
  }
}
