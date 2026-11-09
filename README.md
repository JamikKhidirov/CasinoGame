# 🎰 Casino Game — Telegram-бот + мультиплеер + Mini App

> Блэкджек, дурак и кости для 2–4 игроков в реальном времени.  
> Telegram-бот, веб-сайт, админ-панель и Telegram Mini App в **одном Docker-контейнере**.  
> Балансы, история игр и активные комнаты сохраняются в **SQLite**.

---

## 📚 Документация

| Документ | О чём |
|----------|-------|
| [🏗 ARCHITECTURE.md](ARCHITECTURE.md) | Архитектура, компоненты, потоки данных, схема БД |
| [📦 DEPLOY.md](DEPLOY.md) | Подробное развёртывание, `.env`, тома, backup, troubleshooting |
| [🔗 API.md](API.md) | HTTP API, Socket.io события, модели данных |
| [📖 README.md](README.md) | Этот файл — быстрый старт и обзор |

---

## 🚀 Запуск одной командой

```bash
# 1. Клонировать репозиторий
git clone https://github.com/JamikKhidirov/CasinoGame.git
cd CasinoGame

# 2. Создать .env из шаблона
cp .env.example .env
```

Откройте `.env` и обязательно задайте:

```env
BOT_TOKEN=токен_от_@BotFather
ADMIN_IDS=ваш_telegram_id
ADMIN_PASSWORD=надёжный_пароль_для_админки
```

Затем:

```bash
# 3. Поднять ВЕСЬ стек: бот + веб + Socket.io + SQLite
docker compose up -d --build
```

Готово. В одном контейнере одновременно работают:

| Сервис | Адрес / описание |
|--------|------------------|
| 🤖 Telegram-бот | polling, команды и игры в чате |
| 🌐 Веб-сайт | http://localhost:3000 |
| 🎮 Игровая комната | http://localhost:3000/game.html |
| 🛠 Админ-панель | http://localhost:3000/admin.html |
| ❤️ Health check | http://localhost:3000/health |
| 💾 SQLite | том `casino_game_data` → `/app/data/casino.db` |

Остановить:

```bash
docker compose down          # данные сохраняются
docker compose down -v       # удалить и контейнер, и базу
```

Логи:

```bash
docker compose logs -f
```

---

## 🎮 Игры

| Игра | Игроки | Правила |
|------|--------|---------|
| 🃏 **Блэкджек 21** | 2–4 | Берите карты или остановитесь. Побеждает лучшая сумма ≤ 21. Перебор — проигрыш. |
| ♠️ **Дурак** | 2–4 | Козырь, атака и защита, подкидывание карт, «бито» и «взять». |
| 🎲 **Кости** | 2–4 | Каждый бросает кубик, у кого больше — тот забирает банк. |

Особенности:

- ⚡ Все ходы мгновенно приходят остальным через Socket.io.
- 💰 Ставки списываются при старте и выплачиваются из общего банка.
- ⏰ Если игрок не ходит `MOVE_TIMEOUT` секунд — сервер делает ход за него.
- 🔄 После игры создатель комнаты может нажать «Играть ещё».
- 🎁 В Telegram-боте доступны `/daily` (ежедневный бонус) и `/ref` (рефералы).

---

## 🏗 Что где лежит

```text
CasinoGame/
├── main.py                 # точка входа Telegram-бота (aiogram 3)
├── config.py               # конфигурация из .env + настройки админа
├── database.py             # SQLite: пользователи, транзакции, игры, рефералы
├── keyboards.py            # клавиатуры бота
├── utils.py                # форматирование и экранирование
│
├── handlers/               # хендлеры бота
│   ├── start.py            # /start, баланс, статистика, /daily, /ref
│   ├── rooms.py            # создание комнат и игровой цикл бота
│   ├── admin.py            # Telegram-админка
│   ├── banner.py           # баннеры и рассылки
│   ├── convert.py          # обмен ⭐ ↔ 💰
│   ├── deposit.py          # пополнение
│   ├── withdraw.py         # вывод
│   ├── promo.py            # промокоды
│   ├── transfer.py         # переводы
│   └── common.py           # общие обработчики
│
├── services/               # бизнес-логика бота
│   ├── rooms.py            # комнаты и игровой цикл
│   ├── banners.py          # рассылка баннеров
│   └── games.py            # справочник игр
│
├── server.js               # Node.js: Express + Socket.io + SQLite для веба
├── start.sh                # запускает node server.js и python main.py
├── package.json            # Node.js зависимости
├── requirements.txt        # Python зависимости
│
├── web/                    # фронтенд
│   ├── index.html          # главная страница
│   ├── game.html           # игровая комната
│   ├── admin.html          # веб-админ-панель
│   ├── style.css           # glassmorphism-дизайн и анимации
│   ├── app.js              # логика главной страницы
│   ├── game.js             # клиент блэкджека, дурака и костей
│   └── admin.js            # клиент админ-панели
│
├── Dockerfile              # Python + Node.js в одном образе
├── docker-compose.yml      # один сервис = весь стек
├── .env.example            # шаблон переменных окружения
├── .dockerignore
├── run_tests.py            # 109 тестов Python-логики
│
├── ARCHITECTURE.md
├── DEPLOY.md
├── API.md
└── README.md
```

---

## 💾 Где сохраняются данные

Бот и веб-сервер используют **одну и ту же SQLite-базу** по пути `DB_PATH` (в Docker — `/app/data/casino.db`).

| Таблица | Что хранит |
|---------|------------|
| `users` | пользователи, баланс 💰, очки ⭐, рефералы |
| `transactions` | все операции: ставки, выигрыши, возвраты, пополнения |
| `game_stats` | история игр и статистика |
| `web_rooms` | снимки активных веб-комнат (переживают перезапуск) |
| `promocodes`, `promo_uses` | промокоды |
| `deposits`, `withdrawals` | заявки на пополнение и вывод |
| `banners`, `banner_sends` | баннеры и рассылки |
| `settings` | настройки, изменяемые админом |

Файл базы лежит в Docker-томе `casino_game_data`. Пересборка контейнера **не удаляет** данные. Backup и восстановление — в [DEPLOY.md](DEPLOY.md#-backup-и-восстановление).

> Пользователи Telegram Mini App используют свой настоящий Telegram ID и видят тот же баланс, что и в боте.  
> Гости сайта без Telegram получают отрицательный ID и отдельный стартовый баланс.

---

## 🔐 Админ-панель

Откройте `http://localhost:3000/admin.html` и введите пароль из `ADMIN_PASSWORD`.

Возможности:

- 📊 статистика: пользователи, суммарный баланс, комнаты, игры;
- 🔴 список активных комнат и принудительное закрытие с возвратом ставок;
- 💳 изменение баланса игрока по ID;
- 📢 рассылка сообщения всем онлайн-игрокам;
- 🧾 последние 50 транзакций.

Telegram-админка бота (`/admin`) остаётся отдельной и работает через команды бота.

---

## 📱 Telegram Mini App

1. Задайте `BOT_TOKEN` в `.env`.
2. Поднимите стек: `docker compose up -d --build`.
3. Сайт должен быть доступен по **HTTPS** на публичном домене (Telegram требует HTTPS для Mini App).
4. В `@BotFather`: `/setmenubutton` → укажите URL вашего сайта.
5. Пользователь открывает Mini App из бота — используется его Telegram-имя и ID.

Подробнее про HTTPS и reverse proxy: [DEPLOY.md](DEPLOY.md#-telegram-mini-app-и-https).

---

## ⚙️ Переменные окружения

Полный список — в [DEPLOY.md](DEPLOY.md#-переменные-окружения). Самые важные:

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `BOT_TOKEN` | — | токен от @BotFather |
| `ADMIN_IDS` | — | Telegram ID админов через запятую |
| `ADMIN_PASSWORD` | `admin123` | пароль веб-админки (смените!) |
| `PORT` | `3000` | порт веб-сервера |
| `DB_PATH` | `/app/data/casino.db` | путь к SQLite |
| `START_BALANCE` | `1000` | стартовый баланс 💰 |
| `START_POINTS` | `2000` | стартовые очки ⭐ |
| `MIN_BET` / `MAX_BET` | `1` / `1000000` | лимиты ставок |
| `COMMISSION_PERCENT` | `0` | комиссия казино, % |
| `MOVE_TIMEOUT` | `30` | секунд до авто-хода |
| `CORS_ORIGIN` | `*` | CORS для Socket.io |

---

## 🧪 Тесты

```bash
# Windows PowerShell
$env:PYTHONIOENCODING="utf-8"; python run_tests.py

# Linux / macOS
python run_tests.py
```

Ожидаемый результат:

```text
ВСЕ ТЕСТЫ ПРОЙДЕНЫ (109)
```

Тесты покрывают базу данных, экономику, комнаты, ставки, ничьи, игру с ботом, рассылки и промокоды.

---

## 🛠 Быстрый troubleshooting

| Проблема | Решение |
|----------|---------|
| Контейнер не стартует | `docker compose logs -f` — чаще всего не задан `BOT_TOKEN` |
| Порт 3000 занят | Измените `"3000:3000"` на `"8080:3000"` в `docker-compose.yml` |
| Не пускает в админку | Проверьте `ADMIN_PASSWORD` в `.env` и перезапустите контейнер |
| `/game.html` или `/admin.html` → 404 | Убедитесь, что используется свежий образ: `docker compose up -d --build` |
| Данные пропали | Не используйте `docker compose down -v` — он удаляет том с базой |
| Mini App не открывается | Нужен HTTPS-домен, а не `localhost` |

Полный troubleshooting: [DEPLOY.md](DEPLOY.md#-troubleshooting).

---

## 🔗 Полезные ссылки

- [🏗 Архитектура](ARCHITECTURE.md)
- [📦 Развёртывание](DEPLOY.md)
- [🔗 API](API.md)

---

<div align="center">

**Удачи в игре! 🎰🃏♠️🎲**

</div>
