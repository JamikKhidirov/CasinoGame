/**
 * 🧪 E2E-тест веб-казино: настоящий сервер + настоящий socket.io-client.
 *
 * Поднимает casino/server.js на свободном порту с временной SQLite,
 * подключает двух игроков и полностью проигрывает партии:
 *   • Кости    — оба бросают кубик, проверяются результаты и выплаты
 *   • Блэкджек — ходы hit/stand до завершения
 *   • Дурак    — атака/защита/бито до завершения
 *
 * Запуск:  node tests/web_e2e.js
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { io } = require(path.join(__dirname, "..", "casino", "node_modules", "socket.io-client"));

const ROOT = path.resolve(__dirname, "..");
const PORT = 4123 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP_DB = path.join(os.tmpdir(), `casino_e2e_${Date.now()}.db`);

let passed = 0;
let failed = 0;
function ok(name) {
  passed += 1;
  console.log(`  OK  ${name}`);
}
function fail(name, extra) {
  failed += 1;
  console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`);
}
function check(cond, name, extra) {
  if (cond) ok(name);
  else fail(name, extra);
}

function once(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for "${event}"`));
    }, timeoutMs);
    function handler(payload) {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

function waitForState(client, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.socket.off("roomUpdated", handler);
      reject(new Error("timeout waiting for room state"));
    }, timeoutMs);
    function handler(state) {
      if (!predicate(state)) return;
      clearTimeout(timer);
      client.socket.off("roomUpdated", handler);
      resolve(state);
    }
    client.socket.on("roomUpdated", handler);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer() {
  const node = process.execPath;
  const child = spawn(node, [path.join(ROOT, "casino", "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: TMP_DB,
      ADMIN_PASSWORD: "e2e-pass",
      MOVE_TIMEOUT: "15",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (buf) => {
    const text = String(buf);
    if (!/ExperimentalWarning/.test(text)) process.stdout.write(`[server] ${text}`);
  });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return child;
    } catch (_) { /* сервер ещё стартует */ }
    await sleep(200);
  }
  throw new Error("server did not start");
}

function connectClient(userId, name) {
  const socket = io(BASE, { transports: ["websocket"], reconnection: false, forceNew: true });
  const client = { socket, userId, name, state: null, errors: [] };
  socket.on("roomUpdated", (state) => { client.state = state; });
  socket.on("error", (data) => { client.errors.push(data && data.message); });
  socket.on("gameFinished", (payload) => { client.finished = payload; });
  return client;
}

function act(client, action, cardId) {
  client.socket.emit("playerAction", cardId ? { action, cardId } : { action });
}

async function createRoom(host, guest, gameType, bet = 100) {
  const hostJoined = once(host.socket, "joined");
  const hostStarted = once(host.socket, "gameStarted");
  host.socket.emit("join", {
    userId: host.userId,
    userName: host.name,
    gameType,
    bet,
    maxPlayers: 2,
  });
  const joined = await hostJoined;
  const roomId = joined.roomId;

  const guestJoined = once(guest.socket, "joined");
  guest.socket.emit("join", { userId: guest.userId, userName: guest.name, roomId });
  await guestJoined;

  await waitForState(guest, (s) => s.players.length === 2);
  host.socket.emit("startGame");
  await hostStarted;
  return roomId;
}

/* ------------------------------- Кости ------------------------------ */
async function testDice(host, guest) {
  console.log("КОСТИ");
  await createRoom(host, guest, "dice");

  const finished = Promise.all([
    once(host.socket, "gameFinished", 20000),
    once(guest.socket, "gameFinished", 20000),
  ]);

  const clients = [host, guest];
  for (let step = 0; step < 20; step += 1) {
    const room = clients[0].state;
    if (!room || room.status !== "playing") break;
    const current = clients.find((c) => c.state && c.state.currentTurn === c.state.yourId);
    if (!current) {
      await sleep(120);
      continue;
    }
    const me = current.state.players.find((p) => p.id === current.state.yourId);
    if (me && me.dice) {
      await sleep(120);
      continue;
    }
    act(current, "roll");
    await waitForState(current, (s) => {
      const mine = s.players.find((p) => p.id === s.yourId);
      return !mine || mine.dice !== null;
    }).catch(() => {});
  }

  const [hostEnd, guestEnd] = await finished;
  const finalState = host.state;
  check(finalState.status === "finished", "игра завершилась");
  check(Array.isArray(hostEnd.winner) && hostEnd.winner.length >= 1, "есть победитель");
  const diceValues = Object.values(finalState.results || {}).map((r) => r.dice);
  check(diceValues.length === 2 && diceValues.every((v) => Number.isInteger(v) && v >= 1 && v <= 6),
    "у обоих игроков корректные броски", JSON.stringify(diceValues));
  const payouts = Object.values(finalState.results || {}).reduce((sum, r) => sum + (r.payout || 0), 0);
  check(payouts === finalState.bet * 2, "банк выплачен полностью", `payouts=${payouts}`);
  check(host.errors.length === 0 && guest.errors.length === 0,
    "нет ошибок у клиентов", JSON.stringify([...host.errors, ...guest.errors]));
  check(guestEnd && guestEnd.results, "результаты пришли всем");
}

/* ----------------------------- Блэкджек ----------------------------- */
async function testBlackjack(host, guest) {
  console.log("БЛЭКДЖЕК");
  host.state = null;
  guest.state = null;
  await createRoom(host, guest, "blackjack");

  const finished = Promise.all([
    once(host.socket, "gameFinished", 25000),
    once(guest.socket, "gameFinished", 25000),
  ]);

  const clients = [host, guest];
  for (let step = 0; step < 40; step += 1) {
    const room = host.state;
    if (!room || room.status !== "playing") break;
    const current = clients.find((c) => c.state && c.state.currentTurn === c.state.yourId);
    if (!current) {
      await sleep(120);
      continue;
    }
    const me = current.state.players.find((p) => p.id === current.state.yourId);
    if (!me || me.stood || me.busted) {
      await sleep(120);
      continue;
    }
    const action = me.score < 17 && Math.random() > 0.25 ? "hit" : "stand";
    act(current, action);
    await sleep(150);
  }

  await finished;
  const finalState = host.state;
  check(finalState.status === "finished", "игра завершилась");
  const scores = finalState.players.map((p) => p.score);
  check(scores.every((s) => Number.isInteger(s) && s >= 2), "очки посчитаны", JSON.stringify(scores));
  check(finalState.players.every((p) => p.handCount >= 2), "у всех есть карты");
  check(Object.keys(finalState.results || {}).length === 2, "результаты по всем игрокам");
  check(host.errors.length === 0 && guest.errors.length === 0,
    "нет ошибок у клиентов", JSON.stringify([...host.errors, ...guest.errors]));
}

/* ------------------------------- Дурак ------------------------------ */
function canBeat(card, target, trumpSuit) {
  if (card.suit === target.suit) return card.value > target.value;
  if (card.suit === trumpSuit && target.suit !== trumpSuit) return true;
  return false;
}

async function testDurak(host, guest) {
  console.log("ДУРАК");
  host.state = null;
  guest.state = null;
  await createRoom(host, guest, "durak");

  const finished = Promise.all([
    once(host.socket, "gameFinished", 40000),
    once(guest.socket, "gameFinished", 40000),
  ]);

  const clients = [host, guest];
  let lastSignature = "";

  for (let step = 0; step < 400; step += 1) {
    const room = host.state;
    if (!room || room.status !== "playing") break;

    const signature = JSON.stringify({
      t: room.table, a: room.attacker, d: room.defender, turn: room.currentTurn,
      hands: room.players.map((p) => p.handCount),
    });
    if (signature === lastSignature) {
      await sleep(150);
      continue;
    }
    lastSignature = signature;

    const current = clients.find((c) => c.state && c.state.currentTurn === c.state.yourId);
    if (!current) {
      await sleep(120);
      continue;
    }
    const state = current.state;
    const me = state.players.find((p) => p.id === state.yourId);
    if (!me) {
      await sleep(120);
      continue;
    }
    const trumpSuit = state.trump ? state.trump.suit : null;
    const table = state.table || [];
    const undefended = table.filter((pair) => !pair.defend);

    if (state.currentTurn === state.defender) {
      if (undefended.length) {
        const pair = undefended[0];
        const card = (me.hand || []).find((c) => canBeat(c, pair.attack, trumpSuit));
        if (card) act(current, "defend", card.id);
        else act(current, "take");
      } else {
        await sleep(120);
      }
    } else if (state.currentTurn === state.attacker) {
      if (table.length && !undefended.length) {
        act(current, "pass");
      } else {
        const ranks = new Set();
        for (const pair of table) {
          if (pair.attack) ranks.add(pair.attack.name);
          if (pair.defend) ranks.add(pair.defend.name);
        }
        const card = ranks.size
          ? (me.hand || []).find((c) => ranks.has(c.name))
          : (me.hand || [])[0];
        if (card) act(current, "attack", card.id);
        else act(current, "pass");
      }
    }
    await sleep(160);
  }

  const [hostEnd] = await finished;
  const finalState = host.state;
  check(finalState.status === "finished", "игра завершилась");
  check(Array.isArray(hostEnd.winner) && hostEnd.winner.length >= 1, "есть победитель");
  check(Object.keys(finalState.results || {}).length === 2, "результаты по всем игрокам");
  const payouts = Object.values(finalState.results || {}).reduce((sum, r) => sum + (r.payout || 0), 0);
  check(payouts === finalState.bet * 2, "банк выплачен полностью", `payouts=${payouts}`);
  check(host.errors.length === 0 && guest.errors.length === 0,
    "нет ошибок у клиентов", JSON.stringify([...host.errors, ...guest.errors]));
}

/* --------------------------- Бот вместо друга ---------------------- */
async function testBotsSolo(host) {
  console.log("БОТЫ (соло)");
  host.state = null;

  const joined = once(host.socket, "joined");
  host.socket.emit("join", {
    userId: host.userId,
    userName: host.name,
    gameType: "dice",
    bet: 50,
    maxPlayers: 2,
  });
  const { roomId } = await joined;
  check(Boolean(roomId), "комната создана");

  const withBot = waitForState(host, (s) => s.players.some((p) => p.isBot));
  host.socket.emit("addBot");
  const botState = await withBot;
  check(
    botState.players.length === 2 && botState.players.some((p) => p.isBot),
    "бот добавлен в комнату"
  );

  const started = once(host.socket, "gameStarted");
  const finished = once(host.socket, "gameFinished", 20000);
  host.socket.emit("startGame");
  await started;

  for (let step = 0; step < 40; step += 1) {
    const state = host.state;
    if (!state || state.status !== "playing") break;
    if (state.currentTurn === state.yourId) {
      const me = state.players.find((p) => p.id === state.yourId);
      if (me && !me.dice) host.socket.emit("playerAction", { action: "roll" });
    }
    await sleep(200);
  }

  const end = await finished;
  check(host.state.status === "finished", "соло-игра с ботом завершилась");
  check(Array.isArray(end.winner) && end.winner.length >= 1, "есть победитель в соло-игре");
  const bot = host.state.players.find((p) => p.isBot);
  check(
    Boolean(bot) && Number.isInteger(bot.dice) && bot.dice >= 1 && bot.dice <= 6,
    "бот бросил кубик",
    JSON.stringify(bot)
  );
}

/* --------------------- REST: вход, донаты, админка ------------------ */
const sqlite3 = require(path.join(ROOT, "casino", "node_modules", "sqlite3"));

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(TMP_DB);
    db.run(sql, params, function onDone(err) {
      db.close();
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function httpJson(method, urlPath, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  return { status: res.status, data };
}

async function insertLoginCode(code, userId) {
  const now = Math.floor(Date.now() / 1000);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await dbRun(
        "INSERT INTO login_codes (code, user_id, username, first_name, status, created_at, expires_at) "
        + "VALUES (?, ?, ?, ?, 'confirmed', ?, ?)",
        [code, userId, "rest_tester", "REST Тест", now, now + 900]
      );
      return;
    } catch (err) {
      if (!/SQLITE_BUSY/.test(String(err.message))) throw err;
      await sleep(150);
    }
  }
  throw new Error("не удалось записать код входа в БД");
}

async function testRestApi() {
  console.log("REST / ВХОД / ДОНАТЫ / АДМИНКА");

  const unauth = await httpJson("GET", "/api/me/transactions");
  check(unauth.status === 401, "без токена личный кабинет закрыт", String(unauth.status));

  const badCode = await httpJson("POST", "/api/auth/login", { body: { code: "ZZZZZZZZ" } });
  check(badCode.status === 404, "неизвестный код отклонён", String(badCode.status));

  const code = "E2E" + Math.floor(10000 + Math.random() * 89999);
  await insertLoginCode(code, 900001111);
  const login = await httpJson("POST", "/api/auth/login", { body: { code } });
  check(login.status === 200 && login.data?.token, "вход по коду из Telegram работает", String(login.status));
  const token = login.data.token;
  check(login.data?.user?.id === 900001111, "ID аккаунта = Telegram ID", JSON.stringify(login.data?.user));

  const reuse = await httpJson("POST", "/api/auth/login", { body: { code } });
  check(reuse.status === 410, "код одноразовый", String(reuse.status));

  const me = await httpJson("GET", "/api/auth/me", { token });
  check(me.status === 200 && me.data?.user?.id === 900001111, "сессия возвращает игрока");

  const donate = await httpJson("POST", "/api/donate", { token, body: { amount: 500, comment: "e2e" } });
  check(donate.status === 200 && donate.data?.id, "заявка на донат создаётся", String(donate.status));

  const donateBad = await httpJson("POST", "/api/donate", { token, body: { amount: 0 } });
  check(donateBad.status === 400, "нулевой донат отклонён", String(donateBad.status));

  const board = await httpJson("GET", "/api/leaderboard?kind=balance&limit=5");
  check(board.status === 200 && Array.isArray(board.data?.rows), "топ игроков доступен без входа");

  const userStats = await httpJson("GET", "/api/user/900001111/stats");
  check(userStats.status === 200 && userStats.data?.totals, "статистика игрока доступна");

  const adminBad = await httpJson("POST", "/api/admin/login", { body: { password: "wrong" } });
  check(adminBad.status === 401, "неверный пароль админа отклонён", String(adminBad.status));

  const adminLogin = await httpJson("POST", "/api/admin/login", { body: { password: "e2e-pass" } });
  check(adminLogin.status === 200 && adminLogin.data?.token, "вход в админку работает");
  const adminToken = adminLogin.data.token;

  const noAdmin = await httpJson("GET", "/api/admin/overview");
  check(noAdmin.status === 401, "админка без токена закрыта", String(noAdmin.status));

  const overview = await httpJson("GET", "/api/admin/overview", { token: adminToken });
  check(overview.status === 200 && overview.data?.totalUsers >= 1, "обзор админки отдаёт статистику");

  const credit = await httpJson("POST", "/api/admin/balance", {
    token: adminToken,
    body: { userId: 900001111, delta: 250, reason: "E2E начисление" },
  });
  check(credit.status === 200 && credit.data?.balance === 1000 + 250, "админ пополняет баланс",
    JSON.stringify(credit.data));

  const pending = await httpJson("GET", "/api/admin/deposits?status=pending", { token: adminToken });
  const depositRow = (pending.data?.rows || []).find((row) => row.user_id === 900001111);
  check(Boolean(depositRow), "донат виден в админке");

  if (depositRow) {
    const resolve = await httpJson("POST", `/api/admin/deposits/${depositRow.id}/resolve`, {
      token: adminToken,
      body: { approve: true },
    });
    check(resolve.status === 200 && resolve.data?.status === "approved", "админ подтверждает донат");

    const approved = await httpJson("GET", "/api/admin/deposits?status=approved", { token: adminToken });
    check(
      (approved.data?.rows || []).some((row) => row.id === depositRow.id),
      "подтверждённый донат попадает в историю"
    );
  }

  const users = await httpJson("GET", "/api/admin/users?q=900001111", { token: adminToken });
  const userRow = (users.data?.rows || []).find((row) => row.id === 900001111);
  check(
    userRow && userRow.balance === 1000 + 250 + 500,
    "после доната баланс зачислен",
    JSON.stringify(userRow)
  );

  const txs = await httpJson("GET", "/api/me/transactions", { token });
  check(
    (txs.data?.rows || []).some((row) => row.type === "deposit"),
    "пополнение видно в операциях игрока"
  );

  const logout = await httpJson("POST", "/api/auth/logout", { token });
  check(logout.status === 200, "выход из аккаунта работает");
  const afterLogout = await httpJson("GET", "/api/auth/me", { token });
  check(afterLogout.status === 401, "после выхода токен недействителен", String(afterLogout.status));
}

/* ------------------------------------------------------------------ */
async function main() {
  console.log(`DB: ${TMP_DB}`);
  console.log(`PORT: ${PORT}`);
  const server = await startServer();
  const host = connectClient("900000001", "Хозяин");
  const guest = connectClient("900000002", "Гость");
  try {
    await Promise.all([once(host.socket, "connect"), once(guest.socket, "connect")]);
    await testDice(host, guest);
    await testBlackjack(host, guest);
    await testDurak(host, guest);
    await testBotsSolo(host);
    await testRestApi();
  } catch (err) {
    fail("исключение", err && err.message);
    console.error(err);
  } finally {
    host.socket.close();
    guest.socket.close();
    server.kill("SIGTERM");
    await sleep(800);
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.unlinkSync(TMP_DB + suffix); } catch (_) { /* ignore */ }
    }
  }

  console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
  if (failed === 0) console.log("ALL_WEB_E2E_OK");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
