<a id="top"></a>
<div align="center">

<img src="assets/banner.svg" alt="Casino Game — архитектура" width="100%"/>

<a href="README.md">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=22&duration=2800&pause=800&color=A78BFA&center=true&vCenter=true&multiline=true&width=880&height=100&lines=Bot+%2B+Web+%2B+SQLite+%E2%80%94+one+container;Socket.io+real-time+rooms;Shared+database+with+WAL" alt="Анимация: архитектура"/>
</a>

<br/>

<a href="README.md"><img alt="README" src="https://img.shields.io/badge/📖_README-обзор-3b82f6?style=for-the-badge"/></a>
<a href="ARCHITECTURE.md"><img alt="Architecture" src="https://img.shields.io/badge/🏗_ARCHITECTURE-архитектура-8b5cf6?style=for-the-badge"/></a>
<a href="DEPLOY.md"><img alt="Deploy" src="https://img.shields.io/badge/📦_DEPLOY-развёртывание-10b981?style=for-the-badge"/></a>
<a href="API.md"><img alt="API" src="https://img.shields.io/badge/🔗_API-справочник-f59e0b?style=for-the-badge"/></a>
<a href="BACKEND_TUTORIAL.md"><img alt="Tutorial" src="https://img.shields.io/badge/🎓_TUTORIAL-обучение-ec4899?style=for-the-badge"/></a>

</div>

---

## 📊 Общая схема

```mermaid
flowchart TB
    subgraph Clients["🌐 Клиенты"]
        TG["Telegram-чат"]
        TMA["Telegram Mini App"]
        WEB["Браузер / сайт"]
        ADM["React /admin"]
    end

    subgraph Container["🐳 Docker-контейнер casino-game"]
        subgraph Py["🐍 Python 3.12 + aiogram 3"]
            MAIN["bot/main.py"]
            H["bot/handlers/"]
            SVC["bot/services/"]
        end
        subgraph Node["🟢 Node.js 20"]
            SRV["casino/server.js<br/>Express + Socket.io"]
            FRONT["casino/webapp/src<br/>React SPA → dist"]
        end
        DB[("💾 SQLite<br/>/app/data/casino.db")]
    end

    TG -->|Bot API polling| MAIN
    TMA -->|HTTPS + WebSocket| SRV
    WEB -->|HTTPS + WebSocket| SRV
    ADM -->|REST /api/admin + код из бота| SRV
    MAIN --> H
    MAIN --> SVC
    H --> DB
    SVC --> DB
    SRV --> DB
    SRV --> FRONT

    classDef client fill:#1e3a8a,stroke:#60a5fa,color:#fff
    classDef py fill:#1e40af,stroke:#3b82f6,color:#fff
    classDef node fill:#064e3b,stroke:#10b981,color:#fff
    classDef db fill:#78350f,stroke:#f59e0b,color:#fff
    class TG,TMA,WEB,ADM client
    class MAIN,H,SVC py
    class SRV,FRONT node
    class DB db
```

Оба процесса живут в одном Docker-контейнере, и запускаются одной командой:
`python bot/main.py` (в контейнере — через `start.sh`). Бот сам стартует
Node.js-сайт, ждёт `/health`, перезапускает его при падении и гасит при выходе.
Отключить автозапуск сайта можно через `WEB_AUTOSTART=0`.

### Боты-соперники

В веб-комнате создатель может добавить ботов («🤖 Добавить бота»), чтобы играть
одному. Боты живут только в памяти комнаты, не пишутся в БД и не платят ставку,
поэтому на баланс реальных игроков не влияют.

---

## 🧱 Компоненты

### 1. Telegram-бот (`bot/main.py`, `bot/handlers/`, `bot/services/`)

- `bot/main.py` — создаёт `Bot`, `Dispatcher`, подключает роутеры из `bot/handlers/`.
- `bot/handlers/` — команды, кнопки, FSM-сценарии, админка бота.
- `bot/services/rooms.py` — комнаты и игровой цикл Telegram-игр.
- `bot/services/banners.py` — отложенные рассылки.
- `bot/services/games.py` — справочник нативных игр Telegram.
- `bot/database.py` — единственный слой доступа к SQLite со стороны Python.
- `configs/config.py` — настройки из `.env` (подключается через `PYTHONPATH`).

### 2. Веб-сервер (`casino/server.js`)

- Express отдаёт собранный React-фронтенд `casino/webapp/dist` и HTTP API.
- Socket.io обслуживает мультиплеер в реальном времени.
- В памяти держит `Map<roomId, Room>`; каждый снимок комнаты сохраняется в `web_rooms`.
- При старте восстанавливает комнаты из `web_rooms`.
- Списывает и начисляет баланс через те же таблицы `users`, `transactions`, `game_stats`.
- REST `/api/*` обслуживает вход по коду, кассу, выводы и админку; `/api/mode`
  отдаёт текущий режим «Бизнес/Развлечение».
- В `/api/rooms` попадают только комнаты с онлайн-игроками (`Room.isVisible()`).

### 3. Фронтенд (`casino/webapp/`)

React + Vite. Исходники в `src/`, сборка в `dist/` (её отдаёт Express).

| Файл | Назначение |
|------|------------|
| `pages/HomePage.jsx` | главная: вход по коду, создание/поиск комнат, ставка, число игроков |
| `pages/GamePage.jsx` | игровая комната: карты, кубики, действия, результаты; при выходе отправляет `leaveRoom` |
| `pages/DonatePage.jsx` | касса: пополнение, вывод на карту/счёт, история заявок |
| `pages/StatsPage.jsx` | топы и личная статистика |
| `pages/AdminPage.jsx` | вход по коду из бота, статистика, комнаты, балансы, донаты, выводы, режим, настройки |
| `components/Layout.jsx` | адаптивная навигация; в режиме `fun` скрывает «Кассу» |
| `context/AppContext.jsx` | сессия игрока, токен, режим и тосты |
| `styles.css` | glassmorphism, анимации, адаптивная вёрстка (мобильный таб-бар) |

Подробности серверной части — в [BACKEND.md](BACKEND.md), обучающий разбор — в
[BACKEND_TUTORIAL.md](BACKEND_TUTORIAL.md).

### 4. SQLite

Одна база для обоих процессов:

```text
users            — id, username, first_name, balance, points, last_daily, referrer_id
transactions     — ставки, выигрыши, возвраты, пополнения, выводы
game_stats       — история игр (game_key, bet, result, amount, opponent)
web_rooms        — JSON-снимки активных веб-комнат
promocodes       — промокоды
promo_uses       — использования промокодов
deposits         — заявки на пополнение (source: site | bot)
withdrawals      — заявки на вывод + реквизиты (payout_method, payout_target,
                   payout_name, payout_bank, source)
login_codes      — одноразовые коды входа (kind: player | admin)
web_sessions     — сессии сайта и админки
banners          — баннеры и авто-рассылки
banner_sends     — кому уже отправлен баннер
settings         — настройки админа, включая APP_MODE (business | fun)
referrals        — реферальные связи
```

SQLite работает в режиме **WAL** (`PRAGMA journal_mode=WAL`), включён `busyTimeout`, поэтому бот и веб-сервер могут писать одновременно.

---

## 🔄 Потоки данных

### Создание комнаты

```mermaid
sequenceDiagram
    autonumber
    participant B as 🌐 Browser
    participant S as 🟢 server.js
    participant DB as 💾 SQLite

    B->>S: join {userId, userName, gameType, bet, maxPlayers}
    S->>DB: ensureUser() → users
    S->>S: new Room(...) → rooms Map
    S->>DB: saveRoom() → web_rooms
    S-->>B: joined {roomId, userId}
    B->>B: redirect → /game?room=...
```

### Старт игры и списание ставок

```mermaid
sequenceDiagram
    autonumber
    participant C as 👑 Создатель
    participant S as 🟢 server.js
    participant DB as 💾 SQLite

    C->>S: startGame
    S->>S: минимум 2 игрока, статус waiting
    S->>DB: BEGIN IMMEDIATE
    S->>DB: UPDATE users SET balance = balance - bet<br/>WHERE balance >= bet
    S->>DB: INSERT transactions (type='bet')
    S->>S: initBlackjack / initDurak / initDice
    S->>DB: saveRoom()
    S-->>C: roomUpdated + gameStarted
```

### Ход игрока

```mermaid
sequenceDiagram
    autonumber
    participant P as 🎮 Player
    participant S as 🟢 server.js
    participant DB as 💾 SQLite

    P->>S: playerAction {action, cardId?}
    S->>S: проверка currentTurn
    S->>S: handleBlackjackAction / handleDurakAction / handleDiceAction
    S->>S: проверка конца игры
    S->>DB: saveRoom() → web_rooms
    S-->>P: roomUpdated (личная проекция комнаты)
    Note over S,P: свои карты видны, чужие — закрыты
```

### Завершение и выплата

```mermaid
sequenceDiagram
    autonumber
    participant S as 🟢 server.js
    participant DB as 💾 SQLite
    participant P as 🎮 Игроки

    S->>S: settleRoom(room, winnerIds)
    S->>S: pool = Σ ставок − commission
    S->>S: победители делят prize
    S->>DB: BEGIN IMMEDIATE
    S->>DB: UPDATE users SET balance = balance + payout
    S->>DB: INSERT transactions (type='win')
    S->>DB: INSERT game_stats (result, amount, opponent)
    S->>S: room.status = finished
    S-->>P: roomUpdated + gameFinished {winner, results}
```

### Вывод на карту или счёт

```mermaid
sequenceDiagram
    autonumber
    participant P as 💳 Игрок
    participant S as 🟢 server.js
    participant DB as 💾 SQLite

    P->>S: POST /api/withdraw {amount, method, target, holder, bank}
    S->>S: режим business? сумма ≥ минимума? реквизиты верны?
    S->>DB: BEGIN IMMEDIATE
    S->>DB: UPDATE users SET balance = balance - amount<br/>WHERE balance >= amount
    S->>DB: INSERT withdrawals (status='pending', реквизиты, source='site')
    S->>DB: INSERT transactions (type='hold')
    S-->>P: {ok, id, balance}
    Note over S,DB: Админ видит реквизиты в /admin → «Выводы»
    Note over S,DB: «Отклонить» → refund и возврат суммы на баланс
```

### Перезапуск сервера

```text
boot()
  ├─ initDb()        — таблицы и миграции
  ├─ loadRooms()     — восстановление web_rooms
  └─ server.listen() — HTTP + Socket.io
```

Если игра шла во время перезапуска и ставки уже были списаны, состояние комнаты сохраняется. Игроки могут переподключиться по ссылке `/game?room=...` и продолжить. Если все отключились более чем на 10 минут — сервер возвращает ставки.

### Очистка комнат

- `Room.isVisible()` — в `/api/rooms` попадают только комнаты с онлайн-игроком.
- `leaveRoom` — явный выход удаляет игрока, пустая комната удаляется сразу.
- Раз в минуту фоновая задача убирает «осиротевшие» и старые комнаты,
  возвращает ставки в брошенных партиях и чистит записи в `web_rooms`.

---

## 🎛 Режим работы: «Бизнес» / «Развлечение»

Режим хранится в `settings` под ключом `APP_MODE` и читается из БД на каждом
запросе — переключение в `/admin` действует сразу, без перезапуска.

| Режим | Поведение |
|---|---|
| `business` | работают донаты, пополнения и выводы |
| `fun` | только игра ради веселья: денежные операции запрещены |

Ограничения действуют на сервере (`403` для `/api/donate` и `/api/withdraw`),
а UI и бот лишь скрывают лишние кнопки. Это важно: клиентские проверки легко
обойти, серверные — нет.

---

## 🎮 Игровые правила в веб-версии

### Блэкджек

- Каждому игроку раздаётся 2 карты из колоды 36 карт.
- Туз = 11, но при переборе становится 1; J/Q/K = 10.
- Игрок может `hit` (взять карту) или `stand` (остановиться).
- При 21 или переборе ход автоматически завершается.
- Когда все остановились/перебрали: побеждает лучшая сумма ≤ 21.
- Несколько игроков с одинаковой лучшей суммой делят банк (ничья).

### Дурак

- Колода 36 карт, козырь — нижняя карта колоды.
- У каждого по 6 карт.
- Атакующий кладёт карту; защищающийся бьёт старшей картой той же масти или козырем.
- Атакующий может подкидывать карты того же достоинства.
- «Бито» — защищающийся отбился, карты уходят в сброс, оба добирают до 6.
- «Взять» — защищающийся забирает карты, атакующий добирает до 6.
- Проигрывает тот, у кого остались карты, когда колода закончилась.

### Кости

- Каждый игрок бросает кубик 1–6.
- Побеждает наибольшее значение.
- При равенстве победители делят банк (ничья).

### Таймауты и авто-ход

| Игра | Поведение по таймауту |
|------|------------------------|
| 🃏 Блэкджек | авто-`stand` |
| ♠️ Дурак | защищающийся берёт карты, атакующий завершает кон |
| 🎲 Кости | кубик бросается автоматически |

- `MOVE_TIMEOUT` секунд на ход (по умолчанию 30).
- Если игрок отключился, его ход всё равно произойдёт по таймауту.

---

## 🔐 Безопасность

| Механизм | Реализация |
|----------|------------|
| Вход игрока | одноразовый код из бота (`login_codes`, TTL 15 минут) → токен на 30 дней |
| Вход админа | отдельный код `kind='admin'` только для `ADMIN_IDS`; сессия 12 часов |
| Пароль админки | только явно заданный `ADMIN_PASSWORD`; `admin123` не работает |
| Проверка админа | `ADMIN_PANEL_ENABLED` + срок сессии + `ADMIN_IDS` на каждом запросе |
| Rate limit | вход 12/мин, донаты и выводы 10/час, админ-вход 8/мин; socket — 60 действий/10 с |
| Валидация | ставки 1..1 000 000, 2–4 игрока, только 3 типа игр; реквизиты вывода проверяются |
| Имена | обрезаются до 24 символов, удаляются управляющие символы и HTML-скобки |
| Ставки | списываются атомарно с проверкой `balance >= bet` |
| Выводы | сумма замораживается (`hold`), при отказе возвращается (`refund`) |
| Режим `fun` | серверный `403` на донат/вывод, кнопки скрываются в UI и боте |
| Скрытые карты | сервер отправляет каждому игроку только его карты |
| CSP | разрешены inline-скрипты и Telegram WebApp, запрещены объекты |
| Docker | непривилегированный пользователь `bot` |
| Секреты | `.env` в `.dockerignore` |

---

## 🧪 Тестирование

- `tests/run_tests.py` — 117 проверок Python-логики (база, экономика, режим,
  реквизиты вывода, комнаты, ставки, ничьи, бот, рассылки).
- `tests/web_e2e.js` — 60 проверок: настоящий `casino/server.js`, три игры,
  боты, вход по коду, донаты, вывод, режим и очистка комнат.
- Для ручной проверки API удобно использовать:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/rooms
curl http://localhost:3000/api/mode
curl http://localhost:3000/api/stats
curl http://localhost:3000/api/user/123456789
```

---

<div align="center">

[📖 README](README.md) · [📦 DEPLOY](DEPLOY.md) · [🔗 API](API.md) · [🎓 BACKEND_TUTORIAL](BACKEND_TUTORIAL.md)

<a href="#top">⬆ Наверх</a>

</div>
