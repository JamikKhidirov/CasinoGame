<a id="top"></a>
<div align="center">

<img src="assets/banner.svg" alt="Casino Game — API Reference" width="100%"/>

<a href="README.md">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=22&duration=2800&pause=800&color=FBBF24&center=true&vCenter=true&multiline=true&width=880&height=100&lines=GET+%2Fhealth;GET+%2Fapi%2Frooms;Socket.io+events+%E2%80%94+join+%C2%B7+startGame+%C2%B7+action;JSON+models+%2B+examples" alt="Анимация: API"/>
</a>

<br/>

<a href="README.md"><img alt="README" src="https://img.shields.io/badge/📖_README-обзор-3b82f6?style=for-the-badge"/></a>
<a href="ARCHITECTURE.md"><img alt="Architecture" src="https://img.shields.io/badge/🏗_ARCHITECTURE-архитектура-8b5cf6?style=for-the-badge"/></a>
<a href="DEPLOY.md"><img alt="Deploy" src="https://img.shields.io/badge/📦_DEPLOY-развёртывание-10b981?style=for-the-badge"/></a>
<a href="API.md"><img alt="API" src="https://img.shields.io/badge/🔗_API-справочник-f59e0b?style=for-the-badge"/></a>

</div>

---

Базовый адрес по умолчанию: `http://localhost:3000`.

---

## 🌐 HTTP API

### `GET /health`

Проверка состояния сервера и базы.

```json
{
  "status": "ok",
  "timestamp": "2026-11-09T12:00:00.000Z",
  "rooms": 2,
  "players": 5,
  "db": "ok"
}
```

При ошибке БД: `503 { "status": "error", "db": "..." }`.

---

### `GET /api/rooms`

Список активных комнат **без скрытых карт**. Попадают только комнаты, где есть
хотя бы один онлайн-игрок: пустые и завершённые комнаты сюда не отдаются.

```json
[
  {
    "id": "A1B2C3",
    "gameType": "blackjack",
    "bet": 100,
    "maxPlayers": 4,
    "status": "waiting",
    "createdAt": 1762689600000,
    "players": [
      { "id": 123456789, "name": "Игрок", "connected": true }
    ]
  }
]
```

`status` может быть `waiting`, `playing` или `finished`, но `finished` в списке
практически не встречается — такие комнаты удаляются фоновой очисткой.

---

### `GET /api/stats`

Публичная статистика.

```json
{
  "totalRooms": 2,
  "online": 5,
  "totalUsers": 12,
  "totalGames": 34,
  "uptime": 3600.5
}
```

---

### `GET /api/user/:id`

Публичные данные пользователя по ID.

```json
{
  "id": 123456789,
  "username": "player",
  "first_name": "Игрок",
  "balance": 1000,
  "points": 2000
}
```

Если пользователь ещё ни разу не заходил в комнату, возвращаются стартовые
значения и `"exists": false` (главная страница показывает стартовый баланс).

> Гости сайта без Telegram получают отрицательный ID.  
> Пользователи Telegram Mini App используют настоящий Telegram ID и общий баланс с ботом.

---

### `GET /tma/init`

Данные темы для Telegram Mini App.

```json
{
  "bot": "casinobot",
  "theme": {
    "bg_color": "#0f172a",
    "text_color": "#ffffff",
    "hint_color": "#94a3b8",
    "link_color": "#3b82f6",
    "button_color": "#3b82f6",
    "button_text_color": "#ffffff"
  }
}
```

---

## 🔐 Вход и профиль

Все защищённые запросы передают токен в заголовке:

```
Authorization: Bearer <token>
```

Игрок получает токен по одноразовому коду из бота (`/site`), админ — по коду
из `/admin` в боте.

### `POST /api/auth/login`

```json
{ "code": "AB12CD34" }
```

Ответ:

```json
{
  "ok": true,
  "token": "64-символьный hex",
  "expiresAt": 1765281600,
  "user": { "id": 123456789, "balance": 1000, "points": 2000 }
}
```

Ошибки: `400` нет кода, `403` админский код на странице игрока, `404` код не
найден, `410` код использован или истёк, `409` код ещё не подтверждён, `429`
слишком много попыток.

### `GET /api/auth/me`

Возвращает `{ ok: true, user }` для действующей сессии; `401` без токена.

### `POST /api/auth/logout`

Удаляет сессию. Тело не нужно.

### `GET /api/leaderboard?kind=balance|points&limit=10`

Топ игроков: `{ kind, rows: [{ id, username, first_name, balance, points }] }`.

### `GET /api/user/:id/stats`

Агрегированная игровая статистика: `totals`, `byGame`, `recent`.

### `GET /api/me/transactions`

Последние 30 операций игрока: `{ rows: [...] }`. Требует токен.

---

## 🎛 Режим и касса

### `GET /api/mode`

Публичный режим работы сайта (без токена):

```json
{
  "mode": "business",
  "business": true,
  "paymentsEnabled": true,
  "title": "Бизнес"
}
```

`mode` = `business` или `fun`. В `fun` пополнения и выводы отключены на сервере.

### `GET /api/donate/info`

Реквизиты пополнения, лимиты, режим и последние заявки игрока:

```json
{
  "cardType": "Сбербанк",
  "cardNumber": "2202 2000 0000 0000",
  "cardName": "Иванов Иван",
  "min": 100,
  "max": 100000,
  "note": "Переведите сумму на карту…",
  "mode": "business",
  "paymentsEnabled": true,
  "withdrawMin": 1000,
  "withdrawNote": "Выплата на карту или счёт…",
  "deposits": [],
  "withdrawals": [],
  "loggedIn": true
}
```

### `POST /api/donate`

```json
{ "amount": 500, "comment": "последние 4 цифры 1111" }
```

Создаёт заявку `deposits` со статусом `pending` и `source='site'`.
Ответ: `{ ok: true, id, amount, status: "pending" }`.
В режиме `fun` — `403`.

### `GET /api/withdraw/info`

`{ withdrawMin, withdrawNote, methods, mode, paymentsEnabled, withdrawals, loggedIn }`.

### `POST /api/withdraw`

```json
{
  "amount": 1000,
  "method": "card",
  "target": "2202 2000 0000 1111",
  "holder": "Иван Иванов",
  "bank": "Сбербанк"
}
```

Правила:

- `method`: `card` (16–19 цифр) или `account` (6–34 буквы/цифры);
- сумма ≥ `WITHDRAW_MIN` и не больше баланса;
- `holder` — минимум 2 символа.

Сумма **сразу замораживается** (`hold`). Ответ:

```json
{ "ok": true, "id": 12, "amount": 1000, "status": "pending", "balance": 750 }
```

Ошибки: `400` неверные данные, `403` режим `fun`, `429` слишком много заявок.

---

## 🛠 Админ-API

Все маршруты требуют админский токен (`Authorization: Bearer <admin token>`).
Доступ проверяется по `ADMIN_PANEL_ENABLED`, сроку сессии и `ADMIN_IDS` на
каждом запросе.

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/admin/status` | доступность панели и способы входа |
| `POST` | `/api/admin/login` | вход по коду из бота или паролю |
| `POST` | `/api/admin/logout` | выход |
| `GET` | `/api/admin/overview` | сводка: игроки, баланс, комнаты, режим |
| `GET` | `/api/admin/users?q=&limit=` | поиск игроков |
| `POST` | `/api/admin/balance` | ручное начисление/списание |
| `GET` | `/api/admin/deposits?status=` | заявки на пополнение |
| `POST` | `/api/admin/deposits/:id/resolve` | `{ approve: true\\|false }` |
| `GET` | `/api/admin/withdrawals?status=` | заявки на вывод с реквизитами |
| `POST` | `/api/admin/withdrawals/:id/resolve` | `{ approve: true\\|false }` |
| `GET` | `/api/admin/transactions` | последние операции |
| `GET` | `/api/admin/settings` | реквизиты, лимиты и режим |
| `PUT` | `/api/admin/settings` | сохранить реквизиты и `mode` |
| `POST` | `/api/admin/broadcast` | сообщение всем онлайн-игрокам |
| `POST` | `/api/admin/close-room` | закрыть комнату с возвратом ставок |

`GET /api/admin/status`:

```json
{
  "available": true,
  "enabled": true,
  "codeLogin": true,
  "passwordLogin": true,
  "adminsConfigured": true
}
```

`PUT /api/admin/settings` принимает:

```json
{
  "mode": "fun",
  "cardType": "Сбербанк",
  "cardNumber": "2202 2000 0000 0000",
  "cardName": "Иванов Иван",
  "note": "Подсказка для пополнения",
  "withdrawMin": 1000,
  "withdrawNote": "Выплата на карту или счёт"
}
```

`mode` валидируется: только `business` или `fun`, иначе `400`.

---


Подключение:

```javascript
const socket = io();
```

```mermaid
sequenceDiagram
    autonumber
    participant C as 💻 Клиент
    participant S as 🟢 server.js
    C->>S: connect
    C->>S: join
    S-->>C: joined + balance
    S-->>C: roomUpdated
    C->>S: startGame
    S-->>C: gameStarted
    C->>S: playerAction
    S-->>C: roomUpdated
    S-->>C: gameFinished
```

### Клиент → сервер

| Событие | Данные | Описание |
|---------|--------|----------|
| `join` | `{ sessionToken?, userId?, userName?, roomId?, gameType?, bet?, maxPlayers? }` | Войти в комнату или создать новую |
| `startGame` | — | Начать игру (только создатель, минимум 2 игрока) |
| `addBot` | — | Добавить бота-соперника (только создатель, до начала игры) |
| `rematch` | — | Перезапустить завершённую игру (только создатель) |
| `playerAction` | `{ action, cardId? }` | Игровой ход |
| `leaveRoom` | — | Выйти из комнаты (пустая комната сразу удаляется) |
| `adminLogin` | `{ password }` | Устаревший socket-вход: только явно заданный `ADMIN_PASSWORD` |
| `adminStats` | — | Статистика для админки |
| `adminTransactions` | — | Последние 50 транзакций |
| `adminAdjustBalance` | `{ userId, delta, reason? }` | Изменить баланс игрока |
| `adminCloseRoom` | `{ roomId }` | Закрыть комнату (ставки вернутся) |
| `adminBroadcast` | `{ message }` | Отправить сообщение всем онлайн-игрокам |

`join` с `sessionToken` игнорирует `userId` из клиента и использует аккаунт из
сессии — иначе можно было бы играть за чужой кошелёк.

> Основная админка (`/admin`) работает через REST `/api/admin/*`; socket-события
> `admin*` оставлены для совместимости и требуют явно заданного пароля.

#### Действия `playerAction`

| Игра | `action` | `cardId` | Смысл |
|------|----------|----------|-------|
| `blackjack` | `hit` | — | Взять карту |
| `blackjack` | `stand` | — | Остановиться |
| `durak` | `attack` | ID карты | Положить карту в атаку |
| `durak` | `defend` | ID карты | Отбить карту |
| `durak` | `take` | — | Забрать карты со стола |
| `durak` | `pass` | — | «Бито» — закончить кон |
| `dice` | `roll` | — | Бросить кубик |

ID карты формируется как `"10♠"`, `"A♥"`, `"6♦"`, `"K♣"`.

---

### Сервер → клиент

| Событие | Данные | Описание |
|---------|--------|----------|
| `joined` | `{ roomId, userId, name, isCreator }` | Успешный вход в комнату |
| `roomUpdated` | `Room` | Персональная проекция комнаты |
| `balance` | `{ userId, balance, points }` | Баланс после входа |
| `gameStarted` | `{ gameType }` | Игра началась |
| `gameFinished` | `{ winner, results }` | Игра завершена, результаты |
| `error` | `{ message }` | Ошибка валидации или хода |
| `adminAuth` | `{ success, message? }` | Результат входа админа |
| `adminStats` | `{ totalRooms, totalUsers, totalBalance, totalGames, uptime, roomsList }` | Статистика админки |
| `adminTransactions` | `Transaction[]` | Транзакции для админки |
| `adminActionResult` | `{ ok, message }` | Результат админ-операции |
| `adminMessage` | `{ message, type }` | Сообщение от админа игрокам |

---

## 🎮 Модели данных

### Room

```typescript
interface Room {
  id: string;                 // "A1B2C3"
  gameType: "blackjack" | "durak" | "dice";
  bet: number;
  maxPlayers: number;         // 2..4
  creatorId: number;
  status: "waiting" | "playing" | "finished";
  createdAt: number;          // Unix ms
  currentTurn: number | null; // чей ход
  trump: Card | null;         // козырь (дурак)
  winner: number[];           // ID победителей
  results: Record<number, GameResult>;
  attacker: number | null;    // дурак
  defender: number | null;    // дурак
  table: TablePair[];         // дурак: пары карт на столе
  deckCount: number;
  yourId: number;             // ID смотрящего
  players: Player[];
}
```

### Player

```typescript
interface Player {
  id: number;
  name: string;
  isBot: boolean;             // 🤖 бот-соперник (не пишется в БД)
  connected: boolean;
  score: number | null;       // null у чужих игроков в блэкджеке
  stood: boolean;
  busted: boolean;
  out: boolean;               // дурак: вышел из игры
  bet: number;
  balance: number;
  dice: number | null;        // кости
  handCount: number;
  hand: Card[];               // только свои карты (или все после финала)
}
```

### Card

```typescript
interface Card {
  id: string;    // "A♠"
  name: string;  // "6".."10", "J", "Q", "K", "A"
  suit: string;  // "♠" | "♥" | "♦" | "♣"
  value: number; // 6..14
}
```

### TablePair

```typescript
interface TablePair {
  attack: Card;
  defend: Card | null;
}
```

### GameResult

```typescript
interface GameResult {
  outcome: "win" | "lose" | "tie";
  amount: number;      // чистая прибыль/убыток
  payout: number;      // сколько начислено
  score: number;       // блэкджек
  dice: number | null; // кости
  cardsLeft: number;   // дурак
}
```

### Transaction

```typescript
interface Transaction {
  id: number;
  user_id: number;
  name: string;
  amount: number;
  type: string;        // bet | win | refund | admin | deposit | withdraw ...
  description: string | null;
  created_at: number;  // Unix seconds
}
```

---

## 💾 Хранение

| Таблица | Назначение |
|---------|------------|
| `users` | пользователи и балансы |
| `transactions` | все денежные операции |
| `game_stats` | история игр |
| `web_rooms` | JSON-снимки активных/недавних веб-комнат |
| `settings` | настройки админа |
| `promocodes`, `promo_uses` | промокоды |
| `deposits`, `withdrawals` | заявки на пополнение и вывод (в `withdrawals` — реквизиты, `source`) |
| `login_codes`, `web_sessions` | одноразовые коды и сессии сайта/админки |
| `banners`, `banner_sends` | баннеры |
| `referrals` | рефералы |

Активные комнаты сохраняются после каждого действия. После перезапуска сервер восстанавливает `web_rooms`; игроки могут переподключиться по ссылке `/game?room=КОД`.

Подробное описание бэкенда — [BACKEND.md](BACKEND.md), обучающий разбор с
анимациями — [BACKEND_TUTORIAL.md](BACKEND_TUTORIAL.md).

---

## 🧪 Пример: создать комнату и начать игру

```javascript
const socket = io("http://localhost:3000");

socket.emit("join", {
  userId: "123456789",
  userName: "Игрок",
  gameType: "blackjack",
  bet: 100,
  maxPlayers: 4,
});

socket.on("joined", ({ roomId, userId }) => {
  console.log("Комната:", roomId, "Игрок:", userId);
  // второй игрок должен выполнить join с roomId
});

socket.on("roomUpdated", (room) => {
  console.log(room.status, room.players.length);
  if (room.creatorId === room.yourId && room.players.length >= 2) {
    socket.emit("startGame");
  }
});

socket.on("gameStarted", () => {
  socket.emit("playerAction", { action: "hit" });
});

socket.on("gameFinished", ({ winner, results }) => {
  console.log("Победители:", winner, results);
});
```

---

<div align="center">

[📖 README](README.md) · [🏗 ARCHITECTURE](ARCHITECTURE.md) · [📦 DEPLOY](DEPLOY.md)

<a href="#top">⬆ Наверх</a>

</div>
