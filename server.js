const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, ".")));

// ============ ИН-МЕМОРИЯ СОСТОЯНИЕ (для MVP, можно заменить на Redis/Postgres) ============
const rooms = new Map(); // roomId -> Room
const users = new Map(); // socketId -> UserInfo
const adminSockets = new Set();

const PORT = process.env.PORT || 3000;
const DAILY_BONUS = 500;
const REFERRAL_BONUS = 100;

// ============ УТИЛИТЫ ============
function generateRoomId() {
  return uuidv4().slice(0, 8).toUpperCase();
}

function shuffleDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = [
    { name: "6", value: 6 }, { name: "7", value: 7 }, { name: "8", value: 8 },
    { name: "9", value: 9 }, { name: "10", value: 10 }, { name: "J", value: 11 },
    { name: "Q", value: 12 }, { name: "K", value: 13 }, { name: "A", value: 14 },
  ];
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, ...rank, id: `${rank.name}${suit}` });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(card) {
  if (card.name === "A") return 11;
  if (["J", "Q", "K"].includes(card.name)) return 10;
  return card.value;
}

// ============ КЛАСС КОМНАТЫ ============
class Room {
  constructor(id, creatorId, creatorName, gameType = "blackjack", bet = 100, maxPlayers = 4) {
    this.id = id;
    this.gameType = gameType; // blackjack, durak, dice
    this.bet = bet;
    this.maxPlayers = maxPlayers;
    this.players = new Map(); // userId -> Player
    this.creatorId = creatorId;
    this.status = "waiting"; // waiting, playing, finished
    this.createdAt = Date.now();
    this.currentTurn = null;
    this.deck = [];
    this.table = []; // cards on table (for durak)
    this.trump = null;
    this.winner = null;
    this.results = {};
    this.bot = false;
  }

  addPlayer(userId, name, isBot = false) {
    if (this.players.size >= this.maxPlayers) return false;
    this.players.set(userId, {
      id: userId,
      name,
      isBot,
      hand: [],
      score: 0,
      stood: false,
      busted: false,
      bet: this.bet,
      balance: 1000,
      ready: false,
    });
    return true;
  }

  removePlayer(userId) {
    return this.players.delete(userId);
  }

  getPlayer(userId) {
    return this.players.get(userId);
  }

  toJSON(includeHidden = false) {
    return {
      id: this.id,
      gameType: this.gameType,
      bet: this.bet,
      maxPlayers: this.maxPlayers,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        score: p.score,
        stood: p.stood,
        busted: p.busted,
        bet: p.bet,
        hand: includeHidden ? p.hand : p.hand.map(c => ({ ...c, hidden: false })),
        balance: p.balance,
        ready: p.ready,
      })),
      status: this.status,
      currentTurn: this.currentTurn,
      table: this.table,
      trump: this.trump,
      winner: this.winner,
      createdAt: this.createdAt,
    };
  }
}

// ============ СОЕДИНЕНИЯ ============
io.on("connection", (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  socket.on("join", (data) => {
    const { userId, userName, roomId } = data;
    users.set(socket.id, { userId, userName, socketId: socket.id });

    let room;
    if (roomId && rooms.has(roomId)) {
      room = rooms.get(roomId);
      if (!room.addPlayer(userId, userName)) {
        socket.emit("error", { message: "Комната переполнена" });
        return;
      }
    } else {
      const newId = roomId || generateRoomId();
      room = new Room(newId, userId, userName, data.gameType || "blackjack", data.bet || 100, data.maxPlayers || 4);
      room.addPlayer(userId, userName);
      rooms.set(newId, room);
    }

    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.userId = userId;

    io.to(room.id).emit("roomUpdated", room.toJSON());
    socket.emit("joined", { roomId: room.id, userId, isCreator: room.creatorId === userId });
  });

  socket.on("startGame", (data) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.creatorId !== socket.data.userId) {
      socket.emit("error", { message: "Только создатель может начать игру" });
      return;
    }
    if (room.players.size < 2) {
      socket.emit("error", { message: "Нужен минимум 1 Opponent" });
      return;
    }

    room.status = "playing";
    room.deck = shuffleDeck();

    if (room.gameType === "blackjack") {
      initBlackjack(room);
    } else if (room.gameType === "durak") {
      initDurak(room);
    }

    io.to(room.id).emit("roomUpdated", room.toJSON());
    io.to(room.id).emit("gameStarted", { gameType: room.gameType });
  });

  socket.on("playerAction", (data) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.getPlayer(socket.data.userId);
    if (!player) return;

    if (room.gameType === "blackjack") {
      handleBlackjackAction(room, player, data.action);
    } else if (room.gameType === "durak") {
      handleDurakAction(room, player, data.action, data.cardId);
    }

    io.to(room.id).emit("roomUpdated", room.toJSON());
  });

  socket.on("disconnect", () => {
    const userInfo = users.get(socket.id);
    if (userInfo) {
      const roomId = socket.data.roomId;
      if (roomId && rooms.has(roomId)) {
        const room = rooms.get(roomId);
        room.removePlayer(userInfo.userId);
        if (room.players.size === 0) {
          rooms.delete(roomId);
        } else {
          io.to(roomId).emit("roomUpdated", room.toJSON());
          io.to(roomId).emit("playerLeft", { userId: userInfo.userId });
        }
      }
      users.delete(socket.id);
    }
    if (adminSockets.has(socket.id)) adminSockets.delete(socket.id);
    console.log(`🔌 User disconnected: ${socket.id}`);
  });

  // ============ ADMIN ============
  socket.on("adminLogin", (data) => {
    if (data.password === process.env.ADMIN_PASSWORD || data.password === "admin123") {
      adminSockets.add(socket.id);
      socket.emit("adminAuth", { success: true });
    } else {
      socket.emit("adminAuth", { success: false });
    }
  });

  socket.on("adminStats", () => {
    if (!adminSockets.has(socket.id)) return;
    socket.emit("adminStats", {
      totalRooms: rooms.size,
      totalUsers: users.size,
      roomsList: Array.from(rooms.values()).map(r => r.toJSON()),
    });
  });

  socket.on("adminBroadcast", (data) => {
    if (!adminSockets.has(socket.id)) return;
    io.emit("adminMessage", { message: data.message, type: data.type || "info" });
  });
});

// ============ BLACKJACK LOGIC ============
function initBlackjack(room) {
  for (const [, p] of room.players) {
    p.hand = [room.deck.pop(), room.deck.pop()];
    p.score = calculateBlackjackScore(p.hand);
    p.stood = false;
    p.busted = false;
  }
  room.currentTurn = Array.from(room.players.keys())[0];
  checkBlackjackEnd(room);
}

function calculateBlackjackScore(hand) {
  let score = 0;
  let aces = 0;
  for (const card of hand) {
    score += cardValue(card);
    if (card.name === "A") aces++;
  }
  while (score > 21 && aces > 0) {
    score -= 10;
    aces--;
  }
  return score;
}

function handleBlackjackAction(room, player, action) {
  if (room.currentTurn !== player.id) return;
  if (player.stood || player.busted) return;

  if (action === "hit") {
    player.hand.push(room.deck.pop());
    player.score = calculateBlackjackScore(player.hand);
    if (player.score > 21) {
      player.busted = true;
    }
    nextTurnBlackjack(room);
  } else if (action === "stand") {
    player.stood = true;
    nextTurnBlackjack(room);
  }
}

function nextTurnBlackjack(room) {
  const playerIds = Array.from(room.players.keys());
  let currentIndex = playerIds.indexOf(room.currentTurn);

  // Find next player who hasn't stood or busted
  let nextIndex = (currentIndex + 1) % playerIds.length;
  while (nextIndex !== currentIndex) {
    const p = room.players.get(playerIds[nextIndex]);
    if (!p.stood && !p.busted) {
      room.currentTurn = playerIds[nextIndex];
      break;
    }
    nextIndex = (nextIndex + 1) % playerIds.length;
  }

  // If all done, dealer plays
  if (nextIndex === currentIndex) {
    // Dealer logic (simple bot dealer)
    const dealer = Array.from(room.players.values()).find(p => p.isBot);
    if (dealer) {
      while (dealer.score < 17 && !dealer.busted) {
        dealer.hand.push(room.deck.pop());
        dealer.score = calculateBlackjackScore(dealer.hand);
        if (dealer.score > 21) dealer.busted = true;
      }
    }
    finishBlackjack(room);
  }
}

function finishBlackjack(room) {
  room.status = "finished";
  const dealerScore = 0;
  const players = Array.from(room.players.values());

  for (const p of players) {
    if (p.busted) {
      p.balance -= p.bet;
      p.results = { outcome: "lose", amount: -p.bet };
    } else {
      let won = false;
      for (const other of players) {
        if (other.id === p.id) continue;
        if (other.busted || p.score > other.score) {
          won = true;
          break;
        }
      }
      if (won) {
        p.balance += p.bet;
        p.results = { outcome: "win", amount: p.bet };
      } else if (players.some(o => o.id !== p.id && !o.busted && o.score === p.score)) {
        p.results = { outcome: "tie", amount: 0 };
      } else {
        p.balance -= p.bet;
        p.results = { outcome: "lose", amount: -p.bet };
      }
    }
  }
}

// ============ DURAK LOGIC ============
function initDurak(room) {
  for (const [, p] of room.players) {
    p.hand = [];
    for (let i = 0; i < 6; i++) p.hand.push(room.deck.pop());
  }
  room.trump = room.deck[room.deck.length - 1];
  room.table = [];
  room.currentTurn = Array.from(room.players.keys())[0];
}

function handleDurakAction(room, player, action, cardId) {
  if (room.currentTurn !== player.id) return;

  if (action === "attack") {
    const card = player.hand.find(c => c.id === cardId);
    if (card) {
      room.table.push({ card, attacker: player.id, defender: null });
      nextTurnDurak(room);
    }
  } else if (action === "defend") {
    // Simplified defense logic
    const attackingCard = room.table.find(t => t.defender === null);
    if (attackingCard && cardId) {
      const defCard = player.hand.find(c => c.id === cardId);
      if (defCard && canBeat(defCard, attackingCard.card, room.trump)) {
        attackingCard.defender = player.id;
        attackingCard.card = defCard;
        player.hand = player.hand.filter(c => c.id !== cardId);
        nextTurnDurak(room);
      }
    }
  }
}

function canBeat(attacking, defending, trump) {
  if (defending.suit === attacking.suit && defending.value > attacking.value) return true;
  if (defending.suit === trump && attacking.suit !== trump) return true;
  return false;
}

function nextTurnDurak(room) {
  const playerIds = Array.from(room.players.keys());
  let idx = playerIds.indexOf(room.currentTurn);
  room.currentTurn = playerIds[(idx + 1) % playerIds.length];
}

// ============ HTTP ROUTES ============
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), rooms: rooms.size });
});

app.get("/api/rooms", (req, res) => {
  res.json(Array.from(rooms.values()).map(r => r.toJSON()));
});

app.get("/api/stats", (req, res) => {
  res.json({
    totalRooms: rooms.size,
    totalUsers: users.size,
    uptime: process.uptime(),
  });
});

// Telegram Mini App WebApp init
app.get("/tma/init", (req, res) => {
  res.json({
    bot: process.env.BOT_USERNAME || "casinobot",
    theme: {
      bg_color: "#0f172a",
      text_color: "#ffffff",
      hint_color: "#94a3b8",
      link_color: "#3b82f6",
      button_color: "#3b82f6",
      button_text_color: "#ffffff",
    },
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

server.listen(PORT, () => {
  console.log(`🎰 Casino server running on port ${PORT}`);
});

module.exports = { app, server, io, rooms };
