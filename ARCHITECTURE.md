# 🏗 Архитектура Casino Game

Общая схема взаимодействия компонентов системы.

---

## 📊 Диаграмма компонентов

```
┌─────────────────────────────────────────────────────────────────┐
│                     📱 Telegram Client                          │
│  (Bot chat, WebApp, inline keyboards, commands)                │
└────────────────────┬────────────────────────────────────────────┘
                     │ Bot API (HTTP/Webhook)
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  🤖 Telegram Bot (Python 3.12 + aiogram 3)                      │
│  ┌─────────────┬─────────────┬─────────────┬───────────────┐   │
│  │ main.py     │ handlers/   │ services/   │ database.py   │   │
│  │ entry point │ game logic  │ business    │ SQLite        │   │
│  │             │             │ logic       │               │   │
│  └─────────────┴─────────────┴─────────────┴───────────────┘   │
└────────────────────┬────────────────────────────────────────────┘
                     │ Socket.io (WebSocket)
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  🌐 Web Server (Node.js 20 + Express + Socket.io)               │
│  ┌─────────────┬─────────────┬─────────────┬───────────────┐   │
│  │ server.js   │ web/        │ game rooms  │ admin panel   │   │
│  │ entry point │ frontend    │ blackjack   │ /admin.html   │   │
│  │             │ glassmorph. │ durak, dice │               │   │
│  └─────────────┴─────────────┴─────────────┴───────────────┘   │
└────────────────────┬────────────────────────────────────────────┘
                     │ SQLite (shared volume)
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  💾 data/casino.db                                                │
│  users, transactions, rooms, referrals, banners, settings       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🐶 Стек технологий

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| Telegram Bot | Python + aiogram | 3.12 + 3.x |
| Web Server | Node.js + Express + Socket.io | 20 + 4.x + 4.x |
| Frontend | HTML5 + CSS3 + JS | — |
| Database | SQLite | 3.x |
| Container | Docker + Docker Compose | — |
| Design | Glassmorphism | — |

---

## 📁 Структура по папкам

```
/app/
├── main.py                 # Bot entry point
├── config.py               # Configuration (.env + runtime settings)
├── database.py             # SQLite wrapper (all DB operations)
├── server.js               # Web server entry point (Node.js)
├── package.json            # Node.js dependencies
├── requirements.txt        # Python dependencies
├── Dockerfile              # Multi-stack Docker image
├── docker-compose.yml      # Single-command deployment
├── .env.example            # Environment variables template
├── .dockerignore           # Docker exclusions
│
├── handlers/               # Bot message handlers (aiogram routers)
│   ├── admin.py            # Admin panel handlers
│   ├── banner.py           # Banner management
│   ├── common.py           # Global cancel / fallback
│   ├── convert.py          # Currency conversion ⭐ ↔ 💰
│   ├── deposit.py          # Deposit requests
│   ├── promo.py            # Promocode activation
│   ├── rooms.py            # Game rooms (join, throw, fold)
│   ├── start.py            # Start, balance, daily bonus, referrals
│   ├── transfer.py         # Transfers and donations
│   └── withdraw.py         # Withdrawal requests
│
├── services/               # Core business logic
│   ├── rooms.py            # Room manager, blackjack, durak game logic
│   ├── banners.py          # Banner broadcasting system
│   └── games.py            # Game definitions (dice, darts, football, etc.)
│
├── web/                    # Frontend application
│   ├── index.html          # Main page (landing + room list)
│   ├── style.css           # Glassmorphism styles + animations
│   └── app.js              # Socket.io client + room management
│
├── data/                   # SQLite database volume
│   └── casino.db           # Persistent database
│
├── ARCHITECTURE.md         # This file
├── DEPLOY.md               # Deployment guide
├── API.md                  # API documentation
└── README.md               # Main documentation
```

---

## 🔄 Поток данных

### Создание комнаты (бот)
```
Пользователь → /games → handlers/start.py → services/rooms.py → database.py
                                                      ↓
                                              Комната создана (статус: waiting)
                                                      ↓
                                              Сообщение в чат с кнопкой «Присоединиться»
```

### Игровой ход (веб, Socket.io)
```
Игрок A → Socket: playerAction { action: "hit" } → server.js
                                                      ↓
                                              handleBlackjackAction()
                                                      ↓
                                              Socket: roomUpdated (всем в комнате)
                                                      ↓
                                              Все игроки видят обновлённое состояние
```

### Ежедневный бонус
```
/daily → handlers/start.py → database.claim_daily() → database.py
                                                      ↓
                                              +500 💰, обновлён last_daily
```

### Реферальный бонус
```
Новый игрок через /start ?start=REF_ID
                                                      ↓
                                              database.set_referrer()
                                                      ↓
                                              Первая ставка → services/rooms.py
                                                      ↓
                                              database.pay_referral_bonus() → рефереру +ставка
```

---

## 🔐 Безопасность

- ✅ `.env` не попадает в образ (добавлен в `.dockerignore`)
- ✅ Пароли админ-панели через переменную `ADMIN_PASSWORD`
- ✅ SQLite в отдельном томе (`/app/data`) — данные сохраняются при пересборке
- ✅ Healthcheck для мониторинга состояния контейнера
- ✅ Непривилегированный пользователь `bot` (uid 1000)

---

## 🔗 Связанная документация

- [📦 Развёртывание](DEPLOY.md) — как запустить проект
- [🔗 API Reference](API.md) — HTTP и Socket.io API
- [📖 README.md](README.md) — основная документация
