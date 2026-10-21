# 🔗 API Reference Casino Game

Документация по HTTP эндпоинтам, Socket.io событиям и Telegram Mini App.

---

## 🌐 HTTP API

### Health Check

```http
GET /health
```

**Ответ:**
```json
{
  "status": "ok",
  "timestamp": "2024-10-21T12:00:00.000Z",
  "rooms": 3
}
```

### Список комнат

```http
GET /api/rooms
```

**Ответ:**
```json
[
  {
    "id": "A1B2C3D4",
    "gameType": "blackjack",
    "bet": 100,
    "maxPlayers": 4,
    "players": [
      {"id": "user_1", "name": "Игрок1", "score": 0, "stood": false, "busted": false, "bet": 100, "balance": 1000, "ready": false}
    ],
    "status": "waiting",
    "createdAt": 1729500000000
  }
]
```

### Статистика

```http
GET /api/stats
```

**Ответ:**
```json
{
  "totalRooms": 5,
  "totalUsers": 12,
  "uptime": 3600.5
}
```

### Telegram Mini App Init

```http
GET /tma/init
```

**Ответ:**
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

## 🔌 Socket.io Events

### Клиент → Сервер

| Событие | Описание | Данные |
|---------|----------|--------|
| `join` | Войти в комнату | `{ userId, userName, roomId?, gameType?, bet?, maxPlayers? }` |
| `startGame` | Начать игру (только создатель) | — |
| `playerAction` | Ход в игре | `{ action: "hit\|stand\|attack\|defend", cardId? }` |
| `adminLogin` | Вход в админку | `{ password }` |
| `adminStats` | Статистика (админ) | — |
| `adminBroadcast` | Рассылка (админ) | `{ message, type }` |

### Сервер → Клиент

| Событие | Описание | Данные |
|---------|----------|--------|
| `joined` | Успешный вход | `{ roomId, userId, isCreator }` |
| `roomUpdated` | Состояние комнаты | `Room` объект |
| `gameStarted` | Игра началась | `{ gameType }` |
| `playerLeft` | Игрок ушёл | `{ userId }` |
| `error` | Ошибка | `{ message }` |
| `adminAuth` | Результат входа админа | `{ success: bool }` |
| `adminStats` | Статистика админки | `{ totalRooms, totalUsers, roomsList }` |
| `adminMessage` | Сообщение от админа | `{ message, type }` |

---

## 📱 Telegram Mini App

### Подключение

В коде бота WebApp инициализируется автоматически:

```javascript
if (window.Telegram?.WebApp) {
  const twa = window.Telegram.WebApp;
  twa.ready();
  twa.expand();
  twa.setHeaderColor("#0f172a");
  twa.setBackgroundColor("#0f172a");
}
```

### Получение init-данных

```javascript
const initData = twa.initDataUnsafe;
// initData.user — информация о пользователе Telegram
```

---

## 🎮 Модель комнаты (Room)

```typescript
interface Room {
  id: string;              // Уникальный ID (8 символов)
  gameType: "blackjack" \| "durak" \| "dice";
  bet: number;             // Ставка
  maxPlayers: number;      // Максимум игроков (2-4)
  players: Player[];       // Список игроков
  status: "waiting" \| "playing" \| "finished";
  currentTurn: string \| null;  // ID игрока whose turn
  createdAt: number;       // Timestamp создания
}

interface Player {
  id: string;
  name: string;
  isBot: boolean;
  hand: Card[];            // Карты в руке
  score: number;           // Очки (блэкджек)
  stood: boolean;          // Пас (блэкджек)
  busted: boolean;         // Перебор (блэкджек)
  bet: number;             // Ставка игрока
  balance: number;         // Баланс
  ready: boolean;          // Готов к игре
}

interface Card {
  id: string;              // Например "A♠"
  name: string;            // "A", "K", "10", etc.
  suit: string;            // "♠", "♥", "♦", "♣"
  value: number;           // Числовое значение
}
```

---

## 🔗 Связанная документация

- [🏗 ARCHITECTURE.md](ARCHITECTURE.md) — архитектура системы
- [📦 DEPLOY.md](DEPLOY.md) — развёртывание
- [📖 README.md](README.md) — основная документация
