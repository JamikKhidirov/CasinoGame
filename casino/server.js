/**
 * 🎰 Casino Game — веб-сервер (Express + Socket.io + SQLite)
 *
 * Один процесс обслуживает:
 *   • React-фронтенд из casino/webapp/dist
 *   • мультиплеер в реальном времени (блэкджек, дурак, кости)
 *   • админ-панель (/admin) и REST API (/api/*)
 *
 * Все пользователи, балансы, транзакции, статистика игр и активные комнаты
 * хранятся в той же SQLite-базе, что и Telegram-бот (DB_PATH).
 */
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const sqlite3 = require("sqlite3");
require("dotenv").config();

/* ------------------------------------------------------------------ */
/*  Конфигурация                                                       */
/* ------------------------------------------------------------------ */
function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) ? value : fallback;
}

const PORT = intEnv("PORT", 3000);
const DB_PATH = process.env.DB_PATH
  ? (path.isAbsolute(process.env.DB_PATH)
      ? process.env.DB_PATH
      : path.resolve(__dirname, process.env.DB_PATH))
  : path.resolve(__dirname, "..", "data", "casino.db");

const START_BALANCE = intEnv("START_BALANCE", 1000);
const START_POINTS = intEnv("START_POINTS", 2000);
const MIN_BET = intEnv("MIN_BET", 1);
const MAX_BET = intEnv("MAX_BET", 1000000);
const COMMISSION_PERCENT = intEnv("COMMISSION_PERCENT", 0);
const TURN_TIMEOUT = Math.max(10, intEnv("MOVE_TIMEOUT", 30)) * 1000;
const ROOM_TTL = 30 * 60 * 1000;
const FINISHED_TTL = 15 * 60 * 1000;

const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim();
const USING_FALLBACK_PASSWORD = !ADMIN_PASSWORD;

// Кто вообще может зайти в веб-админку: только эти Telegram ID.
const ADMIN_IDS = new Set(
  String(process.env.ADMIN_IDS || "")
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value))
);

function envFlag(name, fallback = true) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
}

// Глобальный выключатель админки: 0 — панель полностью недоступна.
const ADMIN_PANEL_ENABLED = envFlag("ADMIN_PANEL_ENABLED", true);
// Пароль — запасной вход (например, если бот временно недоступен).
// По умолчанию он работает только если ADMIN_PASSWORD задан явно.
const ADMIN_PASSWORD_LOGIN = envFlag("ADMIN_PASSWORD_LOGIN", true) && Boolean(ADMIN_PASSWORD);

if (USING_FALLBACK_PASSWORD) {
  console.warn(
    "⚠️  ADMIN_PASSWORD не задан — пароль 'admin123' больше не пускает в веб-админку. " +
    "Задайте ADMIN_PASSWORD или входите по коду из бота."
  );
}

const GAME_TYPES = new Set(["blackjack", "durak", "dice"]);
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

/* ------------------------------------------------------------------ */
/*  SQLite                                                             */
/* ------------------------------------------------------------------ */
const db = new sqlite3.Database(DB_PATH);
db.configure("busyTimeout", 8000);

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

let txChain = Promise.resolve();
function withTx(fn) {
  const result = txChain.then(async () => {
    await dbRun("BEGIN IMMEDIATE");
    try {
      const value = await fn();
      await dbRun("COMMIT");
      return value;
    } catch (err) {
      try { await dbRun("ROLLBACK"); } catch (_) { /* ignore */ }
      throw err;
    }
  });
  txChain = result.catch(() => {});
  return result;
}

async function initDb() {
  await dbRun("PRAGMA journal_mode=WAL");
  await dbRun("PRAGMA foreign_keys=ON");
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      balance INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_daily INTEGER NOT NULL DEFAULT 0,
      referrer_id INTEGER
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      admin_id INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS game_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      game_key TEXT NOT NULL,
      bet INTEGER NOT NULL,
      result TEXT NOT NULL,
      amount INTEGER NOT NULL,
      opponent TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS web_rooms (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Бот и сайт используют одну базу. Сайт умеет работать и без бота,
  // поэтому таблицы входа, донатов, выводов и настроек создаём здесь же.
  await dbRun(`
    CREATE TABLE IF NOT EXISTS login_codes (
      code TEXT PRIMARY KEY,
      user_id INTEGER,
      username TEXT,
      first_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      kind TEXT NOT NULL DEFAULT 'player',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS web_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      processed_at INTEGER,
      admin_id INTEGER,
      source TEXT,
      comment TEXT
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      processed_at INTEGER,
      admin_id INTEGER
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  // Миграции на случай старой базы, созданной прежними версиями бота.
  const userColumns = await dbAll("PRAGMA table_info(users)");
  const columnNames = new Set(userColumns.map((column) => column.name));
  if (!columnNames.has("points")) {
    await dbRun("ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnNames.has("last_daily")) {
    await dbRun("ALTER TABLE users ADD COLUMN last_daily INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnNames.has("referrer_id")) {
    await dbRun("ALTER TABLE users ADD COLUMN referrer_id INTEGER");
  }
  const depositColumns = await dbAll("PRAGMA table_info(deposits)");
  const depositColumnNames = new Set(depositColumns.map((column) => column.name));
  if (!depositColumnNames.has("source")) {
    await dbRun("ALTER TABLE deposits ADD COLUMN source TEXT");
  }
  if (!depositColumnNames.has("comment")) {
    await dbRun("ALTER TABLE deposits ADD COLUMN comment TEXT");
  }
  const codeColumns = await dbAll("PRAGMA table_info(login_codes)");
  if (!codeColumns.some((column) => column.name === "kind")) {
    await dbRun("ALTER TABLE login_codes ADD COLUMN kind TEXT NOT NULL DEFAULT 'player'");
  }
  const adminSessionColumns = await dbAll("PRAGMA table_info(admin_sessions)");
  if (!adminSessionColumns.some((column) => column.name === "user_id")) {
    await dbRun("ALTER TABLE admin_sessions ADD COLUMN user_id INTEGER");
  }
  await dbRun("CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions (user_id, id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_stats_user ON game_stats (user_id, id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_login_codes_user ON login_codes (user_id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions (user_id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits (status)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals (status)");
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/** Приводит любой идентификатор к числу. Гости получают отрицательный ID,
 *  пользователи Telegram Mini App — свой настоящий telegram id. */
function normalizeUserId(raw) {
  const text = String(raw ?? "").trim();
  if (/^-?\d{1,18}$/.test(text)) return Number(text);
  const digest = crypto.createHash("sha256").update(text || "guest").digest();
  return -(digest.readUInt32BE(0) % 2000000000 + 1);
}

function sanitizeName(raw) {
  const cleaned = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "Игрок").slice(0, 24);
}

async function ensureUser(rawId, name) {
  const id = normalizeUserId(rawId);
  const displayName = sanitizeName(name);
  await dbRun(
    `INSERT OR IGNORE INTO users
       (id, username, first_name, balance, points, created_at, last_daily, referrer_id)
     VALUES (?, NULL, ?, ?, ?, ?, 0, NULL)`,
    [id, displayName, START_BALANCE, START_POINTS, nowSec()]
  );
  await dbRun(
    "UPDATE users SET first_name=? WHERE id=? AND (first_name IS NULL OR first_name='')",
    [displayName, id]
  );
  return dbGet(
    "SELECT id, username, first_name, balance, points FROM users WHERE id=?",
    [id]
  );
}

async function getBalance(userId) {
  const row = await dbGet("SELECT balance FROM users WHERE id=?", [userId]);
  return row ? row.balance : 0;
}

async function tryDeduct(userId, amount, description) {
  return withTx(async () => {
    const res = await dbRun(
      "UPDATE users SET balance = balance - ? WHERE id=? AND balance >= ?",
      [amount, userId, amount]
    );
    if (!res.changes) return false;
    await dbRun(
      "INSERT INTO transactions (user_id, amount, type, description, admin_id, created_at) VALUES (?,?,?,?,NULL,?)",
      [userId, -amount, "bet", description, nowSec()]
    );
    return true;
  });
}

async function credit(userId, amount, type, description) {
  await withTx(async () => {
    await dbRun("UPDATE users SET balance = balance + ? WHERE id=?", [amount, userId]);
    await dbRun(
      "INSERT INTO transactions (user_id, amount, type, description, admin_id, created_at) VALUES (?,?,?,?,NULL,?)",
      [userId, amount, type, description, nowSec()]
    );
  });
}

/* ------------------------------------------------------------------ */
/*  Сессии: вход по коду из Telegram, админ по паролю                  */
/* ------------------------------------------------------------------ */
const SESSION_TTL_DAYS = 30;
const ADMIN_SESSION_HOURS = 12;
const CODE_TTL_SECONDS = 15 * 60;

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function normalizeLoginCode(raw) {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function createSession(userId) {
  const token = randomToken();
  const createdAt = nowSec();
  const expiresAt = createdAt + SESSION_TTL_DAYS * 86400;
  await dbRun(
    "INSERT INTO web_sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
    [token, userId, createdAt, expiresAt]
  );
  return { token, expiresAt };
}

async function resolveSession(token) {
  const value = String(token ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  const row = await dbGet("SELECT * FROM web_sessions WHERE token=?", [value]);
  if (!row) return null;
  if (row.expires_at < nowSec()) {
    await dbRun("DELETE FROM web_sessions WHERE token=?", [value]);
    return null;
  }
  const user = await dbGet(
    "SELECT id, username, first_name, balance, points FROM users WHERE id=?",
    [row.user_id]
  );
  return user || null;
}

async function createAdminSession(userId = null) {
  const token = randomToken();
  const createdAt = nowSec();
  const expiresAt = createdAt + ADMIN_SESSION_HOURS * 3600;
  await dbRun(
    "INSERT INTO admin_sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
    [token, userId, createdAt, expiresAt]
  );
  return { token, expiresAt };
}

/** Возвращает { userId } или null. userId=null — вход по паролю. */
async function resolveAdminSession(token) {
  const value = String(token ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  const row = await dbGet("SELECT * FROM admin_sessions WHERE token=?", [value]);
  if (!row) return null;
  if (row.expires_at < nowSec()) {
    await dbRun("DELETE FROM admin_sessions WHERE token=?", [value]);
    return null;
  }
  // Если сессия привязана к Telegram ID, доступ проверяем заново:
  // убрали ID из ADMIN_IDS — сессия сразу перестаёт работать.
  if (row.user_id !== null && row.user_id !== undefined && !ADMIN_IDS.has(row.user_id)) {
    await dbRun("DELETE FROM admin_sessions WHERE token=?", [value]);
    return null;
  }
  return { userId: row.user_id ?? null };
}

/** Состояние админки: включена ли она и какие способы входа доступны. */
function adminAccessInfo() {
  const admins = ADMIN_IDS.size;
  return {
    available: ADMIN_PANEL_ENABLED && (admins > 0 || ADMIN_PASSWORD_LOGIN),
    enabled: ADMIN_PANEL_ENABLED,
    codeLogin: ADMIN_PANEL_ENABLED && admins > 0,
    passwordLogin: ADMIN_PANEL_ENABLED && ADMIN_PASSWORD_LOGIN,
    adminsConfigured: admins > 0,
  };
}

/** Достаёт Bearer-токен из запроса. */
function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return String(req.headers["x-session-token"] || "").trim();
}

async function requireUser(req, res) {
  const user = await resolveSession(bearerToken(req));
  if (!user) {
    res.status(401).json({ error: "Нужен вход по коду из Telegram" });
    return null;
  }
  return user;
}

async function requireAdmin(req, res) {
  if (!(await resolveAdminSession(bearerToken(req)))) {
    res.status(401).json({ error: "Нужен вход в админ-панель" });
    return false;
  }
  return true;
}

function sanitizeAmount(raw, min = 1, max = MAX_BET * 10) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

async function getSetting(key, fallback = "") {
  const row = await dbGet("SELECT value FROM settings WHERE key=?", [key]);
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  await dbRun(
    "INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) "
    + "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
    [key, String(value ?? ""), nowSec()]
  );
}

/* ------------------------------------------------------------------ */
/*  Комнаты                                                            */
/* ------------------------------------------------------------------ */
const rooms = new Map();      // roomId -> Room
const userSockets = new Map(); // socket.id -> { userId, name }
const adminSockets = new Set();
const loginAttempts = new Map();

// Боты живут по «виртуальным» ID за пределами Telegram- и гостевых ID.
const BOT_ID_BASE = -9000000000000;
let botCounter = 0;
const BOT_NAMES = ["🤖 Бот Аня", "🤖 Бот Макс", "🤖 Бот Лиза", "🤖 Бот Тим"];

function generateRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += alphabet[crypto.randomInt(alphabet.length)];
  }
  return rooms.has(id) ? generateRoomId() : id;
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function buildDeck36() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = [
    ["6", 6], ["7", 7], ["8", 8], ["9", 9], ["10", 10],
    ["J", 11], ["Q", 12], ["K", 13], ["A", 14],
  ];
  const deck = [];
  for (const suit of suits) {
    for (const [name, value] of ranks) {
      deck.push({ id: `${name}${suit}`, name, suit, value });
    }
  }
  return shuffle(deck);
}

function cardPoints(card) {
  if (!card) return 0;
  if (card.name === "A") return 11;
  if (["J", "Q", "K"].includes(card.name)) return 10;
  return card.value;
}

function blackjackScore(hand) {
  let score = hand.reduce((sum, card) => sum + cardPoints(card), 0);
  let aces = hand.filter((card) => card.name === "A").length;
  while (score > 21 && aces > 0) {
    score -= 10;
    aces -= 1;
  }
  return score;
}

class Room {
  constructor(id, options = {}) {
    this.id = id;
    this.gameType = GAME_TYPES.has(options.gameType) ? options.gameType : "blackjack";
    this.bet = Math.min(MAX_BET, Math.max(MIN_BET, Number(options.bet) || 100));
    this.maxPlayers = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Number(options.maxPlayers) || 4));
    this.creatorId = options.creatorId ?? null;
    this.status = "waiting"; // waiting | playing | finished
    this.createdAt = Date.now();
    this.finishedAt = null;
    this.currentTurn = null;
    this.deck = [];
    this.table = [];
    this.trump = null;
    this.winner = [];
    this.results = {};
    this.players = new Map();
    this.diceRolls = {};
    this.attacker = null;
    this.defender = null;
    this.betsReserved = false;
    this.settled = false;
    this.lastActivity = Date.now();
    this.turnTimer = null;
    this.deleteTimer = null;
  }

  addPlayer(userId, name, connected = true) {
    const existing = this.players.get(userId);
    if (existing) {
      existing.name = sanitizeName(name);
      existing.connected = connected;
      return true;
    }
    if (this.players.size >= this.maxPlayers) return false;
    this.players.set(userId, {
      id: userId,
      name: sanitizeName(name),
      isBot: false,
      connected,
      hand: [],
      score: 0,
      stood: false,
      busted: false,
      out: false,
      bet: 0,
      balance: 0,
      dice: null,
    });
    return true;
  }

  /** Добавляет бота-соперника. Боты не пишутся в БД и не платят ставку,
   *  поэтому не влияют на баланс реальных игроков. */
  addBot(name) {
    if (this.players.size >= this.maxPlayers) return null;
    botCounter += 1;
    const id = BOT_ID_BASE - botCounter;
    const bot = {
      id,
      name: sanitizeName(name),
      isBot: true,
      connected: true,
      hand: [],
      score: 0,
      stood: false,
      busted: false,
      out: false,
      bet: 0,
      balance: 0,
      dice: null,
    };
    this.players.set(id, bot);
    return bot;
  }

  removePlayer(userId) {
    return this.players.delete(userId);
  }

  getPlayer(userId) {
    return this.players.get(userId);
  }

  activePlayers() {
    return Array.from(this.players.values()).filter((p) => !p.out);
  }

  playerList() {
    return Array.from(this.players.values());
  }

  touch() {
    this.lastActivity = Date.now();
  }

  toState() {
    return {
      id: this.id,
      gameType: this.gameType,
      bet: this.bet,
      maxPlayers: this.maxPlayers,
      creatorId: this.creatorId,
      status: this.status,
      createdAt: this.createdAt,
      finishedAt: this.finishedAt,
      currentTurn: this.currentTurn,
      deck: this.deck,
      table: this.table,
      trump: this.trump,
      winner: this.winner,
      results: this.results,
      diceRolls: this.diceRolls,
      attacker: this.attacker,
      defender: this.defender,
      betsReserved: this.betsReserved,
      settled: this.settled,
      lastActivity: this.lastActivity,
      players: this.playerList(),
    };
  }

  static fromState(state) {
    const room = new Room(state.id, state);
    room.creatorId = state.creatorId;
    room.status = state.status || "waiting";
    room.createdAt = state.createdAt || Date.now();
    room.finishedAt = state.finishedAt || null;
    room.currentTurn = state.currentTurn || null;
    room.deck = Array.isArray(state.deck) ? state.deck : [];
    room.table = Array.isArray(state.table) ? state.table : [];
    room.trump = state.trump || null;
    room.winner = Array.isArray(state.winner) ? state.winner : [];
    room.results = state.results || {};
    room.diceRolls = state.diceRolls || {};
    room.attacker = state.attacker || null;
    room.defender = state.defender || null;
    room.betsReserved = Boolean(state.betsReserved);
    room.settled = Boolean(state.settled);
    room.lastActivity = state.lastActivity || Date.now();
    room.players = new Map();
    for (const p of state.players || []) {
      room.players.set(p.id, {
        id: p.id,
        name: sanitizeName(p.name),
        isBot: Boolean(p.isBot),
        connected: p.isBot ? true : false,
        hand: Array.isArray(p.hand) ? p.hand : [],
        score: Number(p.score) || 0,
        stood: Boolean(p.stood),
        busted: Boolean(p.busted),
        out: Boolean(p.out),
        bet: Number(p.bet) || 0,
        balance: Number(p.balance) || 0,
        dice: p.dice ?? null,
      });
    }
    return room;
  }

  toJSONFor(viewerId, revealAll = false) {
    const finished = this.status === "finished" || revealAll;
    return {
      id: this.id,
      gameType: this.gameType,
      bet: this.bet,
      maxPlayers: this.maxPlayers,
      creatorId: this.creatorId,
      status: this.status,
      createdAt: this.createdAt,
      currentTurn: this.currentTurn,
      trump: this.trump,
      winner: this.winner,
      results: this.results,
      attacker: this.attacker,
      defender: this.defender,
      table: this.table,
      deckCount: this.deck.length,
      yourId: viewerId,
      players: this.playerList().map((p) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        connected: p.connected,
        score: viewerId === p.id || finished ? p.score : null,
        stood: p.stood,
        busted: p.busted,
        out: p.out,
        bet: p.bet,
        balance: p.balance,
        dice: p.dice,
        handCount: p.hand.length,
        hand: viewerId === p.id || finished ? p.hand : [],
      })),
    };
  }

  toPublicJSON() {
    return {
      id: this.id,
      gameType: this.gameType,
      bet: this.bet,
      maxPlayers: this.maxPlayers,
      status: this.status,
      createdAt: this.createdAt,
      players: this.playerList().map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
      })),
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Персистентность комнат                                             */
/* ------------------------------------------------------------------ */
async function saveRoom(room) {
  try {
    await dbRun(
      `INSERT INTO web_rooms (id, state, updated_at) VALUES (?,?,?)
       ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`,
      [room.id, JSON.stringify(room.toState()), Date.now()]
    );
  } catch (err) {
    console.error("Не удалось сохранить комнату", room.id, err.message);
  }
}

async function deleteRoom(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  if (room.deleteTimer) clearTimeout(room.deleteTimer);
  rooms.delete(room.id);
  await dbRun("DELETE FROM web_rooms WHERE id=?", [room.id]);
}

async function loadRooms() {
  const rows = await dbAll("SELECT id, state, updated_at FROM web_rooms");
  for (const row of rows) {
    try {
      const state = JSON.parse(row.state);
      const room = Room.fromState(state);
      if (room.status === "finished" && Date.now() - (room.finishedAt || 0) > FINISHED_TTL) {
        await dbRun("DELETE FROM web_rooms WHERE id=?", [room.id]);
        continue;
      }
      rooms.set(room.id, room);
    } catch (err) {
      console.error("Битая запись комнаты", row.id, err.message);
      await dbRun("DELETE FROM web_rooms WHERE id=?", [row.id]);
    }
  }
  console.log(`💾 Восстановлено комнат из SQLite: ${rooms.size}`);
}

/* ------------------------------------------------------------------ */
/*  Socket.io                                                          */
/* ------------------------------------------------------------------ */
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

app.use(
  helmet({
    // Приложение использует inline-скрипты и onclick, поэтому CSP ослабляем.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://telegram.org"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
        frameAncestors: ["'self'", "https://web.telegram.org", "https://*.telegram.org"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "256kb" }));

// React-приложение собирается в casino/webapp/dist (Vite).
// Если сборки ещё нет — подскажем, как её сделать, вместо пустой страницы.
const STATIC_DIR = path.join(__dirname, "webapp", "dist");
const STATIC_INDEX = path.join(STATIC_DIR, "index.html");
console.log(
  fs.existsSync(STATIC_INDEX)
    ? `🎨 Фронтенд: ${STATIC_DIR}`
    : "⚠️  Нет сборки фронтенда: cd casino/webapp && npm install && npm run build"
);
app.use(express.static(STATIC_DIR));

function broadcastRoom(room) {
  const socketIds = io.sockets.adapter.rooms.get(room.id);
  if (!socketIds) return;
  for (const socketId of socketIds) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) socket.emit("roomUpdated", room.toJSONFor(socket.data.userId));
  }
}

function emitError(socket, message) {
  socket.emit("error", { message });
}

function rateLimit(socket, key, limit, windowMs = 10000) {
  const now = Date.now();
  const mapKey = `${socket.id}:${key}`;
  const entry = loginAttempts.get(mapKey) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + windowMs;
  }
  entry.count += 1;
  loginAttempts.set(mapKey, entry);
  return entry.count <= limit;
}

function clearTurnTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}

function scheduleTurn(room) {
  clearTurnTimer(room);
  if (room.status !== "playing" || !room.currentTurn || room.settled) return;
  const current = room.getPlayer(room.currentTurn);
  const isBot = Boolean(current && current.isBot);
  room.turnTimer = setTimeout(() => {
    if (isBot) botTurn(room).catch((err) => console.error("botTurn:", err));
    else autoTurn(room).catch((err) => console.error("autoTurn:", err));
  }, isBot ? 900 : TURN_TIMEOUT);
}

/** Ход бота: та же логика, что и у игрока, но решение принимается автоматически. */
async function botTurn(room) {
  if (room.status !== "playing" || room.settled) return;
  const bot = room.getPlayer(room.currentTurn);
  if (!bot || !bot.isBot) return;

  if (room.gameType === "blackjack") {
    handleBlackjackAction(room, bot, bot.score < 17 ? "hit" : "stand");
  } else if (room.gameType === "dice") {
    if (room.diceRolls[bot.id] === undefined) handleDiceAction(room, bot, "roll");
  } else if (room.gameType === "durak") {
    if (room.currentTurn === room.defender) {
      const pair = room.table.find((item) => !item.defend);
      if (pair) {
        const card = bot.hand.find((c) => cardBeats(c, pair.attack, room.trump?.suit));
        if (card) handleDurakAction(room, bot, "defend", card.id);
        else handleDurakAction(room, bot, "take");
      }
    } else if (room.currentTurn === room.attacker) {
      const undefended = room.table.filter((pair) => !pair.defend);
      if (room.table.length && !undefended.length) {
        handleDurakAction(room, bot, "pass");
      } else {
        const ranks = tableRanks(room);
        const card = room.table.length
          ? bot.hand.find((c) => ranks.has(c.name))
          : bot.hand[0];
        if (card) handleDurakAction(room, bot, "attack", card.id);
        else handleDurakAction(room, bot, "pass");
      }
    }
  }

  room.touch();
  if (room.status === "playing" && !room.settled) {
    await saveRoom(room);
    broadcastRoom(room);
    scheduleTurn(room);
  } else {
    broadcastRoom(room);
  }
}

function scheduleDeletion(room) {
  if (room.deleteTimer) clearTimeout(room.deleteTimer);
  room.deleteTimer = setTimeout(() => {
    deleteRoom(room).catch(() => {});
  }, FINISHED_TTL);
  if (room.deleteTimer.unref) room.deleteTimer.unref();
}

/* ------------------------- игровые инициализаторы ------------------ */
function initBlackjack(room) {
  room.deck = buildDeck36();
  room.table = [];
  room.trump = null;
  room.diceRolls = {};
  for (const player of room.playerList()) {
    player.hand = [room.deck.pop(), room.deck.pop()];
    player.score = blackjackScore(player.hand);
    player.stood = player.score >= 21;
    player.busted = false;
    player.out = false;
    player.dice = null;
  }
  room.currentTurn = room.playerList()[0]?.id ?? null;
  advanceBlackjackTurn(room);
}

function nextActiveId(room, fromId) {
  const ids = room.activePlayers().map((p) => p.id);
  if (!ids.length) return null;
  const index = ids.indexOf(fromId);
  return ids[(index + 1 + ids.length) % ids.length];
}

function advanceBlackjackTurn(room) {
  const players = room.playerList();
  const pending = players.filter((p) => !p.stood && !p.busted);
  if (!pending.length) {
    finishBlackjack(room).catch((err) => console.error("finishBlackjack:", err));
    return;
  }
  if (!pending.some((p) => p.id === room.currentTurn)) {
    room.currentTurn = pending[0].id;
  }
  scheduleTurn(room);
}

async function finishBlackjack(room) {
  if (room.status !== "playing" || room.settled) return;
  const players = room.playerList();
  const alive = players.filter((p) => !p.busted);
  const best = alive.length ? Math.max(...alive.map((p) => p.score)) : null;
  const winners = best === null ? [] : alive.filter((p) => p.score === best).map((p) => p.id);
  await settleRoom(room, winners, "Блэкджек");
}

function initDurak(room) {
  room.deck = buildDeck36();
  room.table = [];
  room.diceRolls = {};
  room.winner = [];
  room.results = {};
  room.settled = false;
  for (const player of room.playerList()) {
    player.hand = [];
    player.out = false;
    player.stood = false;
    player.busted = false;
    player.dice = null;
    for (let i = 0; i < 6 && room.deck.length; i++) player.hand.push(room.deck.pop());
  }
  room.trump = room.deck.length ? room.deck[0] : null;
  const players = room.playerList();
  room.attacker = players[0]?.id ?? null;
  room.defender = players[1]?.id ?? null;
  room.currentTurn = room.attacker;
  scheduleTurn(room);
}

function cardBeats(card, target, trumpSuit) {
  if (!card || !target) return false;
  if (card.suit === target.suit) return card.value > target.value;
  return card.suit === trumpSuit && target.suit !== trumpSuit;
}

function tableRanks(room) {
  const ranks = new Set();
  for (const pair of room.table) {
    if (pair.attack) ranks.add(pair.attack.name);
    if (pair.defend) ranks.add(pair.defend.name);
  }
  return ranks;
}

function drawToSix(room, player) {
  while (player.hand.length < 6 && room.deck.length > 0) {
    player.hand.push(room.deck.pop());
  }
}

function checkDurakEnd(room) {
  if (room.deck.length > 0) return false;
  for (const player of room.playerList()) {
    if (!player.out && player.hand.length === 0) player.out = true;
  }
  const remaining = room.activePlayers();
  if (remaining.length > 1) return false;
  const winners = room.playerList().filter((p) => p.out).map((p) => p.id);
  if (remaining.length === 1) {
    room.winner = winners;
    settleRoom(room, winners, "Дурак").catch((err) => console.error("finishDurak:", err));
    return true;
  }
  room.winner = winners;
  settleRoom(room, winners, "Дурак").catch((err) => console.error("finishDurak:", err));
  return true;
}

function resolveBout(room, defenderTakes) {
  const attacker = room.getPlayer(room.attacker);
  const defender = room.getPlayer(room.defender);
  if (!attacker || !defender) {
    settleRoom(room, [], "Дурак: игрок вышел").catch(() => {});
    return;
  }

  if (defenderTakes) {
    for (const pair of room.table) {
      defender.hand.push(pair.attack);
      if (pair.defend) defender.hand.push(pair.defend);
    }
    room.table = [];
    drawToSix(room, attacker);
  } else {
    const undefended = room.table.filter((pair) => !pair.defend);
    if (undefended.length) return; // нельзя закончить, пока есть неотбитые карты
    room.table = [];
    drawToSix(room, attacker);
    drawToSix(room, defender);
  }

  if (checkDurakEnd(room)) return;

  const afterDefender = nextActiveId(room, room.defender);
  if (defenderTakes) {
    room.attacker = afterDefender;
  } else {
    room.attacker = room.defender;
  }
  if (!room.attacker) {
    settleRoom(room, [], "Дурак").catch(() => {});
    return;
  }
  room.defender = nextActiveId(room, room.attacker);
  room.currentTurn = room.attacker;
  scheduleTurn(room);
  saveRoom(room).catch(() => {});
  broadcastRoom(room);
}

function initDice(room) {
  room.diceRolls = {};
  room.winner = [];
  room.results = {};
  room.settled = false;
  for (const player of room.playerList()) {
    player.hand = [];
    player.out = false;
    player.stood = false;
    player.busted = false;
    player.dice = null;
  }
  room.currentTurn = room.playerList()[0]?.id ?? null;
  scheduleTurn(room);
}

async function finishDice(room) {
  if (room.status !== "playing" || room.settled) return;
  const players = room.playerList();
  const scored = players.map((p) => ({ id: p.id, value: room.diceRolls[p.id] ?? 0 }));
  const best = Math.max(...scored.map((s) => s.value));
  const winners = scored.filter((s) => s.value === best).map((s) => s.id);
  await settleRoom(room, winners, "Кости");
}

/* ------------------------------ выплаты ---------------------------- */
function opponentLabel(room, userId) {
  const names = room
    .playerList()
    .filter((p) => p.id !== userId)
    .map((p) => p.name)
    .join(", ");
  return (names || "player").slice(0, 100);
}

async function settleRoom(room, winnerIds, reason) {
  if (room.status !== "playing" || room.settled) return;
  room.settled = true;
  clearTurnTimer(room);

  const players = room.playerList();
  const pool = players.reduce((sum, p) => sum + p.bet, 0);
  const commission = Math.max(0, Math.floor((pool * COMMISSION_PERCENT) / 100));
  const prize = Math.max(0, pool - commission);

  const winners = [];
  for (const id of winnerIds) {
    if (room.players.has(id) && !winners.includes(id)) winners.push(id);
  }
  // Приз делим только между реальными игроками: боты не платили ставку.
  const paidWinners = winners.filter((id) => {
    const player = room.getPlayer(id);
    return player && !player.isBot;
  });
  const share = paidWinners.length ? Math.floor(prize / paidWinners.length) : 0;
  let extra = paidWinners.length ? prize - share * paidWinners.length : 0;

  const payouts = new Map();
  for (const id of paidWinners) {
    const payout = share + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    payouts.set(id, payout);
  }

  const results = {};
  try {
    await withTx(async () => {
      for (const player of players) {
        if (player.isBot) {
          results[player.id] = {
            outcome: "bot",
            amount: 0,
            payout: 0,
            score: player.score,
            dice: room.diceRolls[player.id] ?? player.dice ?? null,
            cardsLeft: player.hand.length,
          };
          continue;
        }
        const payout = payouts.get(player.id) || 0;
        if (payout > 0) {
          await dbRun("UPDATE users SET balance = balance + ? WHERE id=?", [payout, player.id]);
          await dbRun(
            "INSERT INTO transactions (user_id, amount, type, description, admin_id, created_at) VALUES (?,?,?,?,NULL,?)",
            [player.id, payout, "win", `${reason}: комната ${room.id}`, nowSec()]
          );
        }
        const net = payout - player.bet;
        const outcome = net > 0 ? "win" : net < 0 ? "lose" : "tie";
        const balanceRow = await dbGet("SELECT balance FROM users WHERE id=?", [player.id]);
        player.balance = balanceRow ? balanceRow.balance : player.balance;
        results[player.id] = {
          outcome,
          amount: net,
          payout,
          score: player.score,
          dice: room.diceRolls[player.id] ?? player.dice ?? null,
          cardsLeft: player.hand.length,
        };
        await dbRun(
          "INSERT INTO game_stats (user_id, game_key, bet, result, amount, opponent, created_at) VALUES (?,?,?,?,?,?,?)",
          [player.id, room.gameType, player.bet, outcome, net, opponentLabel(room, player.id), nowSec()]
        );
      }
    });
  } catch (err) {
    room.settled = false;
    throw err;
  }

  room.status = "finished";
  room.finishedAt = Date.now();
  room.winner = winners;
  room.results = results;
  room.currentTurn = null;
  room.touch();
  await saveRoom(room);
  broadcastRoom(room);
  io.to(room.id).emit("gameFinished", { winner: winners, results });
  scheduleDeletion(room);
}

async function refundRoom(room, reason) {
  if (room.status === "finished" || !room.betsReserved) return;
  room.settled = true;
  clearTurnTimer(room);
  const players = room.playerList();
  const results = {};
  try {
    await withTx(async () => {
      for (const player of players) {
        if (player.isBot) {
          results[player.id] = {
            outcome: "bot",
            amount: 0,
            payout: 0,
            score: player.score,
            dice: player.dice ?? null,
            cardsLeft: player.hand.length,
          };
          continue;
        }
        const payout = player.bet;
        if (payout > 0) {
          await dbRun("UPDATE users SET balance = balance + ? WHERE id=?", [payout, player.id]);
          await dbRun(
            "INSERT INTO transactions (user_id, amount, type, description, admin_id, created_at) VALUES (?,?,?,?,NULL,?)",
            [player.id, payout, "refund", `${reason}: комната ${room.id}`, nowSec()]
          );
        }
        results[player.id] = { outcome: "tie", amount: 0, payout, score: player.score, cardsLeft: player.hand.length };
      }
    });
  } catch (err) {
    room.settled = false;
    throw err;
  }
  room.status = "finished";
  room.finishedAt = Date.now();
  room.winner = [];
  room.results = results;
  await saveRoom(room);
  broadcastRoom(room);
  scheduleDeletion(room);
}

/* ------------------------- ходы и авто-ходы ------------------------ */
async function reserveBets(room) {
  const reserved = [];
  for (const player of room.playerList()) {
    if (player.isBot) {
      player.bet = 0; // боты играют бесплатно и не влияют на банк
      player.balance = 0;
      continue;
    }
    const ok = await tryDeduct(player.id, room.bet, `Ставка в веб-комнате ${room.id}`);
    if (!ok) {
      for (const id of reserved) {
        await credit(id, room.bet, "refund", `Возврат ставки: комната ${room.id}`);
      }
      return { ok: false, failedPlayer: player.name };
    }
    reserved.push(player.id);
    player.bet = room.bet;
    player.balance = await getBalance(player.id);
  }
  room.betsReserved = true;
  return { ok: true };
}

async function startRoom(room) {
  if (room.status === "playing") return { ok: false, error: "Игра уже началась" };
  if (room.status === "finished") return { ok: false, error: "Игра уже завершена" };
  if (room.players.size < MIN_PLAYERS) {
    return { ok: false, error: "Нужно минимум 2 игрока" };
  }
  if (room.gameType === "durak" && room.players.size > 4) {
    return { ok: false, error: "В дурака играют до 4 человек" };
  }

  const reservation = await reserveBets(room);
  if (!reservation.ok) {
    return { ok: false, error: `У игрока ${reservation.failedPlayer} недостаточно средств` };
  }

  room.status = "playing";
  room.settled = false;
  room.winner = [];
  room.results = {};
  room.finishedAt = null;
  room.diceRolls = {};
  room.touch();

  try {
    if (room.gameType === "blackjack") initBlackjack(room);
    else if (room.gameType === "durak") initDurak(room);
    else initDice(room);
  } catch (err) {
    console.error("init game:", err);
    await refundRoom(room, "Ошибка запуска игры");
    return { ok: false, error: "Не удалось начать игру, ставки возвращены" };
  }

  await saveRoom(room);
  broadcastRoom(room);
  io.to(room.id).emit("gameStarted", { gameType: room.gameType });
  scheduleTurn(room);
  return { ok: true };
}

async function autoTurn(room) {
  if (room.status !== "playing") return;
  const player = room.getPlayer(room.currentTurn);
  if (!player) {
    // Текущий игрок пропал — передаём ход дальше.
    const next = nextActiveId(room, room.currentTurn);
    room.currentTurn = next;
    if (next) scheduleTurn(room);
    return;
  }

  if (room.gameType === "blackjack") {
    player.stood = true;
    advanceBlackjackTurn(room);
  } else if (room.gameType === "dice") {
    if (room.diceRolls[player.id] === undefined) {
      room.diceRolls[player.id] = crypto.randomInt(1, 7);
      player.dice = room.diceRolls[player.id];
    }
    const pending = room.playerList().filter((p) => room.diceRolls[p.id] === undefined);
    if (!pending.length) await finishDice(room);
    else {
      room.currentTurn = pending[0].id;
      scheduleTurn(room);
    }
  } else if (room.gameType === "durak") {
    if (room.currentTurn === room.defender) {
      resolveBout(room, true);
    } else if (room.currentTurn === room.attacker) {
      const undefended = room.table.filter((pair) => !pair.defend);
      if (room.table.length && !undefended.length) {
        resolveBout(room, false);
      } else if (player.hand.length) {
        const ranks = tableRanks(room);
        const card = room.table.length
          ? player.hand.find((c) => ranks.has(c.name))
          : player.hand[0];
        if (card) {
          player.hand = player.hand.filter((c) => c.id !== card.id);
          room.table.push({ attack: card, defend: null });
          room.currentTurn = room.defender;
          scheduleTurn(room);
        } else {
          resolveBout(room, true);
        }
      } else {
        resolveBout(room, true);
      }
    }
  }

  room.touch();
  if (room.status !== "playing" || room.settled) return;
  await saveRoom(room);
  broadcastRoom(room);
  scheduleTurn(room);
}

function handleBlackjackAction(room, player, action) {
  if (room.currentTurn !== player.id) return "Сейчас не ваш ход";
  if (player.stood || player.busted) return "Ход уже сделан";

  if (action === "hit") {
    if (!room.deck.length) room.deck = buildDeck36();
    player.hand.push(room.deck.pop());
    player.score = blackjackScore(player.hand);
    if (player.score > 21) player.busted = true;
    if (player.score >= 21) player.stood = true;
    advanceBlackjackTurn(room);
  } else if (action === "stand") {
    player.stood = true;
    advanceBlackjackTurn(room);
  } else {
    return "Неизвестное действие";
  }
  return null;
}

function handleDurakAction(room, player, action, cardId) {
  if (room.currentTurn !== player.id) return "Сейчас не ваш ход";

  if (action === "attack") {
    if (player.id !== room.attacker) return "Сейчас атакует другой игрок";
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) return "Карта не найдена";
    if (room.table.length >= 6) return "Больше 6 карт в кону не положить";
    const ranks = tableRanks(room);
    if (ranks.size && !ranks.has(card.name)) return "Нужно подкидывать карту того же достоинства";
    player.hand = player.hand.filter((c) => c.id !== cardId);
    room.table.push({ attack: card, defend: null });
    room.currentTurn = room.defender;
    scheduleTurn(room);
    return null;
  }

  if (action === "defend") {
    if (player.id !== room.defender) return "Сейчас отбивается другой игрок";
    const pair = room.table.find((item) => !item.defend);
    if (!pair) return "Нечего отбивать";
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) return "Карта не найдена";
    if (!cardBeats(card, pair.attack, room.trump?.suit)) return "Эта карта не бьёт";
    player.hand = player.hand.filter((c) => c.id !== cardId);
    pair.defend = card;
    room.currentTurn = room.attacker;
    scheduleTurn(room);
    return null;
  }

  if (action === "take") {
    if (player.id !== room.defender) return "Взять карты может только защищающийся";
    resolveBout(room, true);
    return null;
  }

  if (action === "pass" || action === "bitto") {
    if (player.id !== room.attacker) return "Закончить кон может только атакующий";
    if (!room.table.length) return "Сначала нужно сходить";
    if (room.table.some((pair) => !pair.defend)) return "Есть неотбитые карты";
    resolveBout(room, false);
    return null;
  }

  return "Неизвестное действие";
}

function handleDiceAction(room, player, action) {
  if (room.currentTurn !== player.id) return "Сейчас не ваш ход";
  if (action !== "roll") return "Неизвестное действие";
  if (room.diceRolls[player.id] !== undefined) return "Вы уже бросили";
  const value = crypto.randomInt(1, 7);
  room.diceRolls[player.id] = value;
  player.dice = value;
  const pending = room.playerList().filter((p) => room.diceRolls[p.id] === undefined);
  if (!pending.length) {
    finishDice(room).catch((err) => console.error("finishDice:", err));
  } else {
    room.currentTurn = pending[0].id;
    scheduleTurn(room);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Socket.io события                                                  */
/* ------------------------------------------------------------------ */
io.on("connection", (socket) => {
  console.log(`🔌 connected ${socket.id}`);

  socket.on("join", async (data = {}) => {
    try {
      if (!rateLimit(socket, "join", 20)) {
        emitError(socket, "Слишком много попыток. Подождите немного.");
        return;
      }
      const sessionUser = await resolveSession(data.sessionToken);
      const rawUserId = sessionUser ? sessionUser.id : data.userId;
      const name = sessionUser
        ? sanitizeName(data.userName || sessionUser.first_name || sessionUser.username)
        : sanitizeName(data.userName);
      if (rawUserId === undefined || rawUserId === null || String(rawUserId).trim() === "") {
        emitError(socket, "Не передан идентификатор игрока");
        return;
      }

      const user = await ensureUser(rawUserId, name);
      const userId = user.id;
      userSockets.set(socket.id, { userId, name });

      let room = null;
      const requestedRoomId = String(data.roomId || "").trim().toUpperCase();

      if (requestedRoomId && rooms.has(requestedRoomId)) {
        room = rooms.get(requestedRoomId);
        const existing = room.getPlayer(userId);
        if (!existing && room.status !== "waiting") {
          emitError(socket, "Игра уже началась — войти нельзя");
          return;
        }
        if (!room.addPlayer(userId, name, true)) {
          emitError(socket, "Комната переполнена");
          return;
        }
      } else if (requestedRoomId && !rooms.has(requestedRoomId)) {
        emitError(socket, "Комната не найдена");
        return;
      } else {
        const gameType = GAME_TYPES.has(data.gameType) ? data.gameType : "blackjack";
        const bet = Math.min(MAX_BET, Math.max(MIN_BET, Number.parseInt(data.bet, 10) || 100));
        const maxPlayers = Math.min(
          MAX_PLAYERS,
          Math.max(MIN_PLAYERS, Number.parseInt(data.maxPlayers, 10) || 4)
        );
        const roomId = generateRoomId();
        room = new Room(roomId, { gameType, bet, maxPlayers, creatorId: userId });
        room.addPlayer(userId, name, true);
        rooms.set(roomId, room);
      }

      const player = room.getPlayer(userId);
      if (player) {
        player.connected = true;
        player.balance = await getBalance(userId);
      }
      room.touch();
      socket.join(room.id);
      socket.data.roomId = room.id;
      socket.data.userId = userId;
      socket.data.name = name;

      if (room.status === "waiting") {
        room.creatorId = room.creatorId ?? userId;
      }
      if (room.status === "playing") scheduleTurn(room);

      await saveRoom(room);
      socket.emit("joined", {
        roomId: room.id,
        userId,
        name,
        isCreator: room.creatorId === userId,
      });
      socket.emit("balance", { userId, balance: player?.balance ?? 0, points: user.points ?? 0 });
      broadcastRoom(room);
    } catch (err) {
      console.error("join:", err);
      emitError(socket, "Не удалось войти в комнату");
    }
  });

  socket.on("startGame", async () => {
    try {
      const room = rooms.get(socket.data.roomId);
      if (!room) return;
      if (room.creatorId !== socket.data.userId) {
        emitError(socket, "Только создатель может начать игру");
        return;
      }
      const result = await startRoom(room);
      if (!result.ok) emitError(socket, result.error);
    } catch (err) {
      console.error("startGame:", err);
      emitError(socket, "Ошибка запуска игры");
    }
  });

  socket.on("addBot", async () => {
    try {
      const room = rooms.get(socket.data.roomId);
      if (!room) return;
      if (room.creatorId !== socket.data.userId) {
        emitError(socket, "Только создатель может добавить бота");
        return;
      }
      if (room.status !== "waiting") {
        emitError(socket, "Бота можно добавить только до начала игры");
        return;
      }
      if (room.players.size >= room.maxPlayers) {
        emitError(socket, "Комната заполнена");
        return;
      }
      const bot = room.addBot(BOT_NAMES[room.players.size % BOT_NAMES.length]);
      if (!bot) {
        emitError(socket, "Не удалось добавить бота");
        return;
      }
      room.touch();
      await saveRoom(room);
      broadcastRoom(room);
    } catch (err) {
      console.error("addBot:", err);
      emitError(socket, "Ошибка добавления бота");
    }
  });

  socket.on("rematch", async () => {
    try {
      const room = rooms.get(socket.data.roomId);
      if (!room) return;
      if (room.creatorId !== socket.data.userId) {
        emitError(socket, "Только создатель может перезапустить игру");
        return;
      }
      if (room.status !== "finished") return;
      if (room.deleteTimer) clearTimeout(room.deleteTimer);
      room.status = "waiting";
      room.settled = false;
      room.winner = [];
      room.results = {};
      room.betsReserved = false;
      room.deck = [];
      room.table = [];
      room.trump = null;
      room.currentTurn = null;
      room.attacker = null;
      room.defender = null;
      room.diceRolls = {};
      for (const player of room.playerList()) {
        player.hand = [];
        player.score = 0;
        player.stood = false;
        player.busted = false;
        player.out = false;
        player.bet = 0;
        player.dice = null;
      }
      await startRoom(room);
      if (room.status === "waiting") {
        await saveRoom(room);
        broadcastRoom(room);
      }
    } catch (err) {
      console.error("rematch:", err);
    }
  });

  socket.on("playerAction", async (data = {}) => {
    try {
      if (!rateLimit(socket, "action", 60, 10000)) return;
      const room = rooms.get(socket.data.roomId);
      if (!room || room.status !== "playing") return;
      const player = room.getPlayer(socket.data.userId);
      if (!player) return;

      let error = null;
      if (room.gameType === "blackjack") {
        error = handleBlackjackAction(room, player, data.action);
      } else if (room.gameType === "durak") {
        error = handleDurakAction(room, player, data.action, data.cardId);
      } else if (room.gameType === "dice") {
        error = handleDiceAction(room, player, data.action);
      }
      if (error) {
        emitError(socket, error);
        return;
      }

      room.touch();
      // Если ход завершил игру, settleRoom сам сохранит и разошлёт состояние.
      if (room.status !== "playing" || room.settled) return;
      scheduleTurn(room);
      await saveRoom(room);
      broadcastRoom(room);
    } catch (err) {
      console.error("playerAction:", err);
      emitError(socket, "Ошибка хода");
    }
  });

  socket.on("leaveRoom", async () => {
    try {
      await leaveRoom(socket);
    } catch (err) {
      console.error("leaveRoom:", err);
    }
  });

  socket.on("disconnect", async () => {
    try {
      await leaveRoom(socket, true);
    } catch (err) {
      console.error("disconnect:", err);
    }
    userSockets.delete(socket.id);
    adminSockets.delete(socket.id);
    console.log(`🔌 disconnected ${socket.id}`);
  });

  /* ---------------------------- админ ------------------------------ */
  socket.on("adminLogin", (data = {}) => {
    if (!rateLimit(socket, "adminLogin", 5, 60000)) {
      socket.emit("adminAuth", { success: false, message: "Слишком много попыток" });
      socket.disconnect(true);
      return;
    }
    // Legacy socket-админка: только явно заданный пароль и включённая панель.
    // Пароль по умолчанию и вход по коду сюда не пускаем — для них есть REST API.
    const access = adminAccessInfo();
    const ok =
      access.available
      && ADMIN_PASSWORD_LOGIN
      && Boolean(ADMIN_PASSWORD)
      && typeof data.password === "string"
      && safeEqual(data.password, ADMIN_PASSWORD);
    if (ok) {
      adminSockets.add(socket.id);
      socket.emit("adminAuth", { success: true });
    } else {
      socket.emit("adminAuth", { success: false, message: "Неверный пароль или вход отключён" });
    }
  });

  socket.on("adminStats", async () => {
    if (!adminSockets.has(socket.id)) return;
    try {
      const usersRow = await dbGet(
        "SELECT COUNT(*) AS total, COALESCE(SUM(balance),0) AS balance FROM users"
      );
      const gamesRow = await dbGet("SELECT COUNT(*) AS total FROM game_stats");
      socket.emit("adminStats", {
        totalRooms: rooms.size,
        totalUsers: usersRow.total,
        totalBalance: usersRow.balance,
        totalGames: gamesRow.total,
        uptime: process.uptime(),
        roomsList: Array.from(rooms.values()).map((room) => room.toPublicJSON()),
      });
    } catch (err) {
      console.error("adminStats:", err);
    }
  });

  socket.on("adminTransactions", async () => {
    if (!adminSockets.has(socket.id)) return;
    try {
      const rows = await dbAll(
        `SELECT t.id, t.user_id, t.amount, t.type, t.description, t.created_at,
                COALESCE(u.first_name, u.username, CAST(u.id AS TEXT)) AS name
         FROM transactions t LEFT JOIN users u ON u.id = t.user_id
         ORDER BY t.id DESC LIMIT 50`
      );
      socket.emit("adminTransactions", rows);
    } catch (err) {
      console.error("adminTransactions:", err);
    }
  });

  socket.on("adminAdjustBalance", async (data = {}) => {
    if (!adminSockets.has(socket.id)) return;
    try {
      const userId = normalizeUserId(data.userId);
      const delta = Number.parseInt(data.delta, 10);
      if (!Number.isFinite(delta) || delta === 0) {
        socket.emit("adminActionResult", { ok: false, message: "Некорректная сумма" });
        return;
      }
      const user = await dbGet("SELECT id, first_name FROM users WHERE id=?", [userId]);
      if (!user) {
        socket.emit("adminActionResult", { ok: false, message: "Игрок не найден" });
        return;
      }
      await withTx(async () => {
        await dbRun("UPDATE users SET balance = balance + ? WHERE id=?", [delta, userId]);
        await dbRun(
          "INSERT INTO transactions (user_id, amount, type, description, admin_id, created_at) VALUES (?,?,?,?,NULL,?)",
          [userId, delta, "admin", String(data.reason || "Корректировка админом").slice(0, 200), nowSec()]
        );
      });
      const row = await dbGet("SELECT balance FROM users WHERE id=?", [userId]);
      socket.emit("adminActionResult", {
        ok: true,
        message: `${user.first_name || userId}: баланс ${row.balance}`,
      });
    } catch (err) {
      console.error("adminAdjustBalance:", err);
      socket.emit("adminActionResult", { ok: false, message: "Ошибка операции" });
    }
  });

  socket.on("adminCloseRoom", async (data = {}) => {
    if (!adminSockets.has(socket.id)) return;
    try {
      const room = rooms.get(String(data.roomId || "").toUpperCase());
      if (!room) return;
      if (room.status === "playing") await refundRoom(room, "Комната закрыта админом");
      else await deleteRoom(room);
      socket.emit("adminActionResult", { ok: true, message: "Комната закрыта" });
    } catch (err) {
      console.error("adminCloseRoom:", err);
    }
  });

  socket.on("adminBroadcast", (data = {}) => {
    if (!adminSockets.has(socket.id)) return;
    const message = String(data.message || "").slice(0, 500).trim();
    if (!message) return;
    io.emit("adminMessage", { message, type: "info" });
  });
});

async function leaveRoom(socket, isDisconnect = false) {
  const roomId = socket.data.roomId;
  if (!roomId || !rooms.has(roomId)) return;
  const room = rooms.get(roomId);
  const userId = socket.data.userId;
  const player = room.getPlayer(userId);
  if (!player) return;

  const roomSockets = io.sockets.adapter.rooms.get(roomId);
  const stillConnected = Boolean(
    roomSockets
      && Array.from(roomSockets).some((sid) => {
        if (sid === socket.id) return false;
        const other = io.sockets.sockets.get(sid);
        return other && other.data.userId === userId;
      })
  );

  socket.leave(roomId);
  socket.data.roomId = null;

  if (room.status === "waiting" || (room.status === "finished" && !isDisconnect)) {
    // При явном выходе удаляем игрока сразу. При обрыве связи (перезагрузка
    // страницы, плохой интернет) даём время переподключиться — игрока уберёт
    // периодическая очистка.
    if (!isDisconnect && !stillConnected) {
      room.removePlayer(userId);
      if (!room.playerList().some((p) => !p.isBot)) {
        // В комнате остались только боты — она больше никому не нужна.
        await deleteRoom(room);
        return;
      }
      if (room.creatorId === userId) {
        const nextCreator = room.playerList().find((p) => !p.isBot && p.id !== userId);
        if (nextCreator) {
          room.creatorId = nextCreator.id;
        } else {
          await deleteRoom(room);
          return;
        }
      }
    } else {
      player.connected = stillConnected;
      if (!stillConnected) {
        player.disconnectedAt = Date.now();
      }
    }
  } else {
    player.connected = stillConnected;
    if (!stillConnected) {
      player.disconnectedAt = Date.now();
      if (room.creatorId === userId) {
        const nextCreator = room.playerList().find((p) => p.connected && p.id !== userId);
        if (nextCreator) room.creatorId = nextCreator.id;
      }
    }
  }

  room.touch();
  await saveRoom(room);
  broadcastRoom(room);
}

/* ------------------------------------------------------------------ */
/*  HTTP API                                                           */
/* ------------------------------------------------------------------ */
app.get("/health", async (_req, res) => {
  try {
    await dbGet("SELECT 1 AS ok");
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      rooms: rooms.size,
      players: userSockets.size,
      db: "ok",
    });
  } catch (err) {
    res.status(503).json({ status: "error", db: err.message });
  }
});

app.get("/api/rooms", (_req, res) => {
  res.json(Array.from(rooms.values()).map((room) => room.toPublicJSON()));
});

app.get("/api/stats", async (_req, res) => {
  try {
    const usersRow = await dbGet("SELECT COUNT(*) AS total FROM users");
    const gamesRow = await dbGet("SELECT COUNT(*) AS total FROM game_stats");
    res.json({
      totalRooms: rooms.size,
      online: userSockets.size,
      totalUsers: usersRow.total,
      totalGames: gamesRow.total,
      uptime: process.uptime(),
    });
  } catch (err) {
    res.status(500).json({ error: "db error" });
  }
});

app.get("/api/user/:id", async (req, res) => {
  try {
    const userId = normalizeUserId(req.params.id);
    const user = await dbGet(
      "SELECT id, username, first_name, balance, points FROM users WHERE id=?",
      [userId]
    );
    if (!user) {
      // Игрок ещё не входил в комнату — показываем стартовые значения,
      // чтобы главная страница не сыпала 404 в консоль.
      res.json({
        id: userId,
        username: null,
        first_name: null,
        balance: START_BALANCE,
        points: START_POINTS,
        exists: false,
      });
      return;
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "db error" });
  }
});

app.get("/tma/init", (_req, res) => {
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

/* ------------------------------------------------------------------ */
/*  REST API: вход, игрок, донаты, админка                             */
/* ------------------------------------------------------------------ */
const httpHits = new Map();
function httpRateLimit(req, key, limit, windowMs = 60000) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const mapKey = `${ip}:${key}`;
  const now = Date.now();
  const entry = httpHits.get(mapKey) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + windowMs;
  }
  entry.count += 1;
  httpHits.set(mapKey, entry);
  return entry.count <= limit;
}

let botUsername = String(process.env.BOT_USERNAME || "").trim().replace(/^@/, "");

async function refreshBotUsername() {
  if (botUsername) return botUsername;
  const token = String(process.env.BOT_TOKEN || "").trim();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (data?.ok && data.result?.username) {
      botUsername = data.result.username;
      console.log(`🤖 Бот для входа: @${botUsername}`);
    }
  } catch (err) {
    console.warn(`⚠️  Не удалось получить @username бота: ${err.message}`);
  }
  return botUsername || null;
}

app.get("/api/bot", async (_req, res) => {
  await refreshBotUsername();
  res.json({
    username: botUsername || null,
    url: botUsername ? `https://t.me/${botUsername}` : null,
  });
});

/* ------------------------------ Вход ------------------------------- */
app.post("/api/auth/login", async (req, res) => {
  try {
    if (!httpRateLimit(req, "auth", 12)) {
      res.status(429).json({ error: "Слишком много попыток. Подождите минуту." });
      return;
    }
    const code = normalizeLoginCode(req.body?.code);
    if (!code) {
      res.status(400).json({ error: "Введите код из Telegram" });
      return;
    }
    const row = await dbGet("SELECT * FROM login_codes WHERE code=?", [code]);
    if (!row) {
      res.status(404).json({ error: "Код не найден. Получите новый в боте: /site" });
      return;
    }
    if (row.kind && row.kind !== "player") {
      res.status(403).json({
        error: "Это код админ-панели. Введите его на странице /admin",
      });
      return;
    }
    if (row.used_at) {
      res.status(410).json({ error: "Код уже использован. Получите новый в боте: /site" });
      return;
    }
    if (row.expires_at < nowSec()) {
      res.status(410).json({ error: "Код истёк. Получите новый в боте: /site" });
      return;
    }
    if (!row.user_id) {
      res.status(409).json({ error: "Код ещё не подтверждён в боте" });
      return;
    }
    const name = row.first_name || row.username || `Игрок_${row.user_id}`;
    const user = await ensureUser(row.user_id, name);
    await dbRun("UPDATE login_codes SET used_at=? WHERE code=?", [nowSec(), code]);
    const session = await createSession(user.id);
    res.json({ ok: true, token: session.token, expiresAt: session.expiresAt, user });
  } catch (err) {
    console.error("auth/login:", err);
    res.status(500).json({ error: "Не удалось выполнить вход" });
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: "db error" });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const token = bearerToken(req);
  if (token) await dbRun("DELETE FROM web_sessions WHERE token=?", [token]).catch(() => {});
  res.json({ ok: true });
});

/* ----------------------------- Игроку ------------------------------ */
app.get("/api/leaderboard", async (req, res) => {
  try {
    const kind = req.query.kind === "points" ? "points" : "balance";
    const limit = Math.min(50, Math.max(3, Number.parseInt(req.query.limit, 10) || 10));
    const rows = await dbAll(
      `SELECT id, username, first_name, balance, points FROM users ORDER BY ${kind} DESC, id ASC LIMIT ?`,
      [limit]
    );
    res.json({ kind, rows });
  } catch (err) {
    res.status(500).json({ error: "db error" });
  }
});

app.get("/api/user/:id/stats", async (req, res) => {
  try {
    const userId = normalizeUserId(req.params.id);
    const totals = await dbGet(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN result='win' THEN 1 ELSE 0 END),0) AS wins,
              COALESCE(SUM(CASE WHEN result='lose' THEN 1 ELSE 0 END),0) AS losses,
              COALESCE(SUM(CASE WHEN result='tie' THEN 1 ELSE 0 END),0) AS ties,
              COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0) AS won,
              COALESCE(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END),0) AS lost,
              COALESCE(SUM(amount),0) AS net
         FROM game_stats WHERE user_id=?`,
      [userId]
    );
    const byGame = await dbAll(
      `SELECT game_key, COUNT(*) AS cnt,
              COALESCE(SUM(CASE WHEN result='win' THEN 1 ELSE 0 END),0) AS wins
         FROM game_stats WHERE user_id=? GROUP BY game_key ORDER BY cnt DESC`,
      [userId]
    );
    const recent = await dbAll(
      `SELECT game_key, bet, result, amount, opponent, created_at
         FROM game_stats WHERE user_id=? ORDER BY id DESC LIMIT 10`,
      [userId]
    );
    res.json({ totals, byGame, recent });
  } catch (err) {
    res.status(500).json({ error: "db error" });
  }
});

app.get("/api/me/transactions", async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const rows = await dbAll(
      "SELECT id, amount, type, description, created_at FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 30",
      [user.id]
    );
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: "db error" });
  }
});

/* ----------------------------- Донаты ------------------------------ */
async function donateInfo() {
  return {
    cardType: await getSetting("DONATE_CARD_TYPE", process.env.DONATE_CARD_TYPE || "Сбербанк"),
    cardNumber: await getSetting("DONATE_CARD_NUMBER", process.env.DONATE_CARD_NUMBER || ""),
    cardName: await getSetting("DONATE_CARD_NAME", process.env.DONATE_CARD_NAME || ""),
    min: Math.max(1, intEnv("DONATE_MIN", 100)),
    max: Math.max(1, intEnv("DONATE_MAX", 100000)),
    note: process.env.DONATE_NOTE || "Переведите сумму на карту, затем отправьте заявку. Админ подтвердит пополнение.",
  };
}

app.get("/api/donate/info", async (req, res) => {
  try {
    const info = await donateInfo();
    const user = await resolveSession(bearerToken(req));
    let deposits = [];
    if (user) {
      deposits = await dbAll(
        "SELECT id, amount, status, created_at, processed_at, source FROM deposits WHERE user_id=? ORDER BY id DESC LIMIT 10",
        [user.id]
      );
    }
    res.json({ ...info, deposits, loggedIn: Boolean(user) });
  } catch (err) {
    res.status(500).json({ error: "db error" });
  }
});

app.post("/api/donate", async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!httpRateLimit(req, "donate", 10, 3600000)) {
      res.status(429).json({ error: "Слишком много заявок. Попробуйте позже." });
      return;
    }
    const info = await donateInfo();
    const amount = sanitizeAmount(req.body?.amount, info.min, info.max);
    if (!amount) {
      res.status(400).json({ error: `Сумма от ${info.min} до ${info.max} 💰` });
      return;
    }
    const comment = String(req.body?.comment || "").slice(0, 200);
    const result = await dbRun(
      "INSERT INTO deposits (user_id, amount, status, created_at, source, comment) VALUES (?,?, 'pending', ?, 'site', ?)",
      [user.id, amount, nowSec(), comment]
    );
    res.json({ ok: true, id: result.lastID, amount, status: "pending" });
  } catch (err) {
    console.error("donate:", err);
    res.status(500).json({ error: "Не удалось создать заявку" });
  }
});

/* ------------------------------ Админ ------------------------------ */
app.get("/api/admin/status", (_req, res) => {
  // Публичная информация: можно ли вообще открыть админку и как входить.
  res.json(adminAccessInfo());
});

app.post("/api/admin/login", async (req, res) => {
  try {
    if (!httpRateLimit(req, "admin", 8, 60000)) {
      res.status(429).json({ error: "Слишком много попыток. Подождите минуту." });
      return;
    }
    const access = adminAccessInfo();
    if (!access.available) {
      res.status(403).json({
        error: access.enabled
          ? "Админ-панель не настроена: добавьте ADMIN_IDS в .env и перезапустите бота"
          : "Админ-панель отключена (ADMIN_PANEL_ENABLED=0)",
      });
      return;
    }

    const code = normalizeLoginCode(req.body?.code);
    const password = String(req.body?.password || "");

    // 1) Основной вход — одноразовый код, который бот выдаёт только админам.
    if (code) {
      if (!access.codeLogin) {
        res.status(403).json({ error: "Вход по коду недоступен: ADMIN_IDS не задан" });
        return;
      }
      const row = await dbGet("SELECT * FROM login_codes WHERE code=?", [code]);
      if (!row) {
        res.status(404).json({ error: "Код не найден. Получите новый: /admin в боте" });
        return;
      }
      if (row.kind !== "admin") {
        res.status(403).json({ error: "Это код игрока, а не админ-панели" });
        return;
      }
      if (row.used_at) {
        res.status(410).json({ error: "Код уже использован. Получите новый: /admin в боте" });
        return;
      }
      if (row.expires_at < nowSec()) {
        res.status(410).json({ error: "Код истёк. Получите новый: /admin в боте" });
        return;
      }
      // Повторная проверка: код выдаётся только админам, но ADMIN_IDS мог измениться.
      if (!row.user_id || !ADMIN_IDS.has(row.user_id)) {
        res.status(403).json({ error: "Этот Telegram-аккаунт не является администратором" });
        return;
      }
      await dbRun("UPDATE login_codes SET used_at=? WHERE code=?", [nowSec(), code]);
      const session = await createAdminSession(row.user_id);
      res.json({
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        admin: { id: row.user_id, name: row.first_name || row.username || `ID ${row.user_id}` },
      });
      return;
    }

    // 2) Запасной вход по паролю (если ADMIN_PASSWORD задан явно).
    if (password) {
      if (!access.passwordLogin) {
        res.status(403).json({
          error: "Вход по паролю отключён. Используйте код из бота: /admin",
        });
        return;
      }
      if (!safeEqual(password, ADMIN_PASSWORD)) {
        res.status(401).json({ error: "Неверный пароль" });
        return;
      }
      const session = await createAdminSession(null);
      res.json({ ok: true, token: session.token, expiresAt: session.expiresAt, admin: null });
      return;
    }

    res.status(400).json({ error: "Введите код из бота или пароль" });
  } catch (err) {
    console.error("admin/login:", err);
    res.status(500).json({ error: "Ошибка входа" });
  }
});

app.post("/api/admin/logout", async (req, res) => {
  const token = bearerToken(req);
  if (/^[a-f0-9]{64}$/.test(token)) {
    await dbRun("DELETE FROM admin_sessions WHERE token=?", [token]).catch(() => {});
  }
  res.json({ ok: true });
});

app.get("/api/admin/overview", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const usersRow = await dbGet(
      "SELECT COUNT(*) AS total, COALESCE(SUM(balance),0) AS balance, COALESCE(SUM(points),0) AS points FROM users"
    );
    const gamesRow = await dbGet(
      "SELECT COUNT(*) AS total, COALESCE(SUM(amount),0) AS net FROM game_stats"
    );
    const pendingDeposits = await dbGet("SELECT COUNT(*) AS cnt FROM deposits WHERE status='pending'");
    const pendingWithdrawals = await dbGet("SELECT COUNT(*) AS cnt FROM withdrawals WHERE status='pending'");
    res.json({
      totalUsers: usersRow.total,
      totalBalance: usersRow.balance,
      totalPoints: usersRow.points,
      totalGames: gamesRow.total,
      totalRooms: rooms.size,
      online: userSockets.size,
      pendingDeposits: pendingDeposits.cnt,
      pendingWithdrawals: pendingWithdrawals.cnt,
      uptime: process.uptime(),
      rooms: Array.from(rooms.values()).map((room) => room.toPublicJSON()),
      card: await donateInfo(),
    });
  } catch (err) {
    res.status(500).json({ error: "db error" });
  }
});

app.get("/api/admin/users", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(100, Math.max(5, Number.parseInt(req.query.limit, 10) || 30));
    let rows;
    if (q) {
      const numeric = /^-?\d+$/.test(q) ? Number(q) : null;
      rows = await dbAll(
        `SELECT id, username, first_name, balance, points FROM users
          WHERE id=? OR username LIKE ? OR first_name LIKE ?
          ORDER BY balance DESC LIMIT ?`,
        [numeric, `%${q}%`, `%${q}%`, limit]
      );
    } else {
      rows = await dbAll(
        "SELECT id, username, first_name, balance, points FROM users ORDER BY balance DESC LIMIT ?",
        [limit]
      );
    }
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: "db error" });
  }
});

app.post("/api/admin/balance", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const userId = normalizeUserId(req.body?.userId);
    const delta = Number.parseInt(req.body?.delta, 10);
    if (!Number.isFinite(delta) || delta === 0) {
      res.status(400).json({ error: "Некорректная сумма" });
      return;
    }
    const user = await dbGet("SELECT id, first_name FROM users WHERE id=?", [userId]);
    if (!user) {
      res.status(404).json({ error: "Игрок не найден" });
      return;
    }
    const reason = String(req.body?.reason || "Корректировка админом").slice(0, 200);
    await withTx(async () => {
      await dbRun("UPDATE users SET balance = balance + ? WHERE id=?", [delta, userId]);
      await dbRun(
        "INSERT INTO transactions (user_id, amount, type, description, admin_id, created_at) VALUES (?,?,?,?,NULL,?)",
        [userId, delta, delta > 0 ? "deposit" : "admin", reason, nowSec()]
      );
    });
    const row = await dbGet("SELECT balance FROM users WHERE id=?", [userId]);
    res.json({ ok: true, balance: row.balance });
  } catch (err) {
    console.error("admin/balance:", err);
    res.status(500).json({ error: "Ошибка операции" });
  }
});

app.get("/api/admin/deposits", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const status = ["pending", "approved", "rejected"].includes(req.query.status)
      ? req.query.status
      : "pending";
    const rows = await dbAll(
      `SELECT d.id, d.user_id, d.amount, d.status, d.created_at, d.processed_at, d.source, d.comment,
              COALESCE(u.first_name, u.username, CAST(u.id AS TEXT)) AS name
         FROM deposits d LEFT JOIN users u ON u.id = d.user_id
        WHERE d.status=? ORDER BY d.id DESC LIMIT 100`,
      [status]
    );
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: "db error" });
  }
});

app.post("/api/admin/deposits/:id/resolve", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number.parseInt(req.params.id, 10);
    const approve = Boolean(req.body?.approve);
    const deposit = await dbGet("SELECT * FROM deposits WHERE id=? AND status='pending'", [id]);
    if (!deposit) {
      res.status(404).json({ error: "Заявка не найдена или уже обработана" });
      return;
    }
    const ts = nowSec();
    await withTx(async () => {
      if (approve) {
        await dbRun("UPDATE users SET balance = balance + ? WHERE id=?", [deposit.amount, deposit.user_id]);
        await dbRun(
          "INSERT INTO transactions (user_id, amount, type, description, admin_id, created_at) VALUES (?,?,?,?,NULL,?)",
          [deposit.user_id, deposit.amount, "deposit", `Пополнение баланса #${id}`, ts]
        );
      }
      await dbRun("UPDATE deposits SET status=?, processed_at=? WHERE id=?", [
        approve ? "approved" : "rejected",
        ts,
        id,
      ]);
    });
    res.json({ ok: true, status: approve ? "approved" : "rejected" });
  } catch (err) {
    console.error("admin/deposits:", err);
    res.status(500).json({ error: "Ошибка обработки заявки" });
  }
});

app.get("/api/admin/withdrawals", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const status = ["pending", "approved", "rejected"].includes(req.query.status)
      ? req.query.status
      : "pending";
    const rows = await dbAll(
      `SELECT w.id, w.user_id, w.amount, w.status, w.created_at, w.processed_at,
              COALESCE(u.first_name, u.username, CAST(u.id AS TEXT)) AS name
         FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id
        WHERE w.status=? ORDER BY w.id DESC LIMIT 100`,
      [status]
    );
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: "db error" });
  }
});

app.post("/api/admin/withdrawals/:id/resolve", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number.parseInt(req.params.id, 10);
    const approve = Boolean(req.body?.approve);
    const row = await dbGet("SELECT * FROM withdrawals WHERE id=? AND status='pending'", [id]);
    if (!row) {
      res.status(404).json({ error: "Заявка не найдена или уже обработана" });
      return;
    }
    const ts = nowSec();
    await withTx(async () => {
      if (!approve) {
        await dbRun("UPDATE users SET balance = balance + ? WHERE id=?", [row.amount, row.user_id]);
        await dbRun(
          "INSERT INTO transactions (user_id, amount, type, description, admin_id, created_at) VALUES (?,?,?,?,NULL,?)",
          [row.user_id, row.amount, "refund", `Отклонение заявки на вывод #${id}`, ts]
        );
      }
      await dbRun("UPDATE withdrawals SET status=?, processed_at=? WHERE id=?", [
        approve ? "approved" : "rejected",
        ts,
        id,
      ]);
    });
    res.json({ ok: true, status: approve ? "approved" : "rejected" });
  } catch (err) {
    console.error("admin/withdrawals:", err);
    res.status(500).json({ error: "Ошибка обработки заявки" });
  }
});

app.get("/api/admin/transactions", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const rows = await dbAll(
      `SELECT t.id, t.user_id, t.amount, t.type, t.description, t.created_at,
              COALESCE(u.first_name, u.username, CAST(u.id AS TEXT)) AS name
         FROM transactions t LEFT JOIN users u ON u.id = t.user_id
         ORDER BY t.id DESC LIMIT 60`
    );
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: "db error" });
  }
});

app.post("/api/admin/broadcast", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const message = String(req.body?.message || "").slice(0, 500).trim();
  if (!message) {
    res.status(400).json({ error: "Пустое сообщение" });
    return;
  }
  io.emit("adminMessage", { message, type: "info" });
  res.json({ ok: true });
});

app.get("/api/admin/settings", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json(await donateInfo());
});

app.put("/api/admin/settings", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const map = {
      cardType: "DONATE_CARD_TYPE",
      cardNumber: "DONATE_CARD_NUMBER",
      cardName: "DONATE_CARD_NAME",
      note: "DONATE_NOTE",
    };
    for (const [field, key] of Object.entries(map)) {
      if (typeof req.body?.[field] === "string") {
        await setSetting(key, req.body[field].slice(0, 300));
      }
    }
    res.json({ ok: true, ...(await donateInfo()) });
  } catch (err) {
    res.status(500).json({ error: "Не удалось сохранить настройки" });
  }
});

app.post("/api/admin/close-room", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const room = rooms.get(String(req.body?.roomId || "").toUpperCase());
    if (!room) {
      res.status(404).json({ error: "Комната не найдена" });
      return;
    }
    if (room.status === "playing") await refundRoom(room, "Комната закрыта админом");
    else await deleteRoom(room);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Не удалось закрыть комнату" });
  }
});

app.get("*", (_req, res) => {
  if (!fs.existsSync(STATIC_INDEX)) {
    res
      .status(503)
      .type("html")
      .send(
        "<!doctype html><meta charset='utf-8'><title>Casino Game</title>"
          + "<body style='font-family:sans-serif;padding:2rem;background:#0b1120;color:#f8fafc'>"
          + "<h1>Сайт ещё не собран</h1>"
          + "<p>Выполните в папке проекта:</p>"
          + "<pre style='background:#111a30;padding:1rem;border-radius:10px'>"
          + "cd casino/webapp\nnpm install\nnpm run build</pre>"
          + "<p>Или просто перезапустите <code>python bot/main.py</code> — он соберёт фронтенд сам.</p>"
          + "</body>"
      );
    return;
  }
  res.sendFile(STATIC_INDEX);
});

/* ------------------------------------------------------------------ */
/*  Обслуживание: таймауты и очистка                                   */
/* ------------------------------------------------------------------ */
setInterval(async () => {
  const now = Date.now();
  for (const room of Array.from(rooms.values())) {
    try {
      const humans = room.playerList().filter((p) => !p.isBot);
      const allOffline = !humans.some((p) => p.connected);
      if (room.status === "playing" && allOffline && now - room.lastActivity > 10 * 60 * 1000) {
        await refundRoom(room, "Все игроки отключились");
        continue;
      }
      if (room.status === "finished" && now - (room.finishedAt || room.lastActivity) > FINISHED_TTL) {
        await deleteRoom(room);
        continue;
      }
      if (room.status === "waiting" && !humans.some((p) => p.connected)
          && now - room.lastActivity > 2 * 60 * 1000) {
        await deleteRoom(room);
        continue;
      }
      if (room.status === "waiting" && now - room.lastActivity > ROOM_TTL) {
        await deleteRoom(room);
      }
    } catch (err) {
      console.error("cleanup:", err);
    }
  }
  loginAttempts.clear();
}, 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/*  Запуск / остановка                                                 */
/* ------------------------------------------------------------------ */
async function boot() {
  await initDb();
  await loadRooms();
  server.listen(PORT, () => {
    console.log(`🎰 Casino web server: http://localhost:${PORT}`);
    console.log(`💾 SQLite: ${DB_PATH}`);
    console.log(`🛠  Admin:  http://localhost:${PORT}/admin`);
    if (USING_FALLBACK_PASSWORD) {
      console.log("🔑 Админ-вход: только по коду из бота (/admin → «Войти в веб-админку»).");
    }
    refreshBotUsername();
  });
}

async function shutdown(signal) {
  console.log(`\n${signal}: останавливаем сервер...`);
  for (const room of rooms.values()) {
    try { await saveRoom(room); } catch (_) { /* ignore */ }
  }
  io.close();
  server.close(() => {
    db.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

boot().catch((err) => {
  console.error("Не удалось запустить сервер:", err);
  process.exit(1);
});

module.exports = { app, server, io, rooms, Room };
