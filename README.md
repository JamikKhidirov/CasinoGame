<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:6a11cb,50:2575fc,100:f7b32b&height=210&section=header&text=Casino%20Bot&fontSize=66&fontColor=ffffff&fontAlignY=30&animation=fadeIn&desc=Telegram%20casino%20on%20aiogram%203%20%2B%20SQLite&descAlignY=50&descSize=18" width="100%" alt="Casino Bot"/>

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=700&size=24&duration=2600&pause=800&color=F7B32B&center=true&vCenter=true&width=780&height=55&lines=Casino+Bot+%7C+aiogram+3;7+games+%C2%B7+2+currencies;1v1+rooms+%2B+play+vs+bot;Docker+ready+%C2%B7+109+tests+passing" alt="Typing SVG"/>

<br>

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![aiogram](https://img.shields.io/badge/aiogram-3.x-2F3096?style=for-the-badge&logo=telegram&logoColor=white)](https://aiogram.dev)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)
[![Tests](https://img.shields.io/badge/Tests-109%20passing-2ea44f?style=for-the-badge&logo=githubactions&logoColor=white)](#-тесты)
[![License](https://img.shields.io/badge/License-MIT-f7b32b?style=for-the-badge)](https://opensource.org/licenses/MIT)

<br>

<img src="https://media.giphy.com/media/rTngfTlB9wbLBG5Ia8/giphy-downsized.gif" width="300" alt="🎲 Dice"/>

<h3>🎰 Играй с друзьями или против бота — прямо в Telegram</h3>

</div>

---

## ✨ Возможности

| 🎮 Игры | 💰 Экономика | 🛠 Сервис |
|:--------|:-------------|:----------|
| 7 игр на нативных Telegram-анимациях | Баланс 💰 + очки бота ⭐ | Админ-панель `/admin` |
| Комнаты 1×1 с таймаутами | Обмен ⭐ ↔ 💰 по курсу | Заявки на пополнение и вывод |
| Быстрая игра против бота | Промокоды с копируемой ссылкой | Ручная и авто-рассылка баннеров |
| Ничья → ставка возвращается | Переводы, донат по карте | Топы, история, личная статистика |

---

## 🎮 Игры

| Игра | Эмодзи | Ставка | Результат |
|:-----|:------:|:------:|:---------:|
| Кубик | 🎲 | 1 – 1 000 000 | `1–6` |
| Дротики | 🎯 | 10 – 100 000 | `0–5` |
| Футбол | ⚽ | 1 – 1 000 000 | `3+ = гол` |
| Баскетбол | 🏀 | 1 – 1 000 000 | `3+ = гол` |
| Боулинг | 🎳 | 1 – 1 000 000 | `1–6` |
| Слот | 🎰 | 1 – 1 000 000 | `слоты` |
| Монетка | 🪙 | 10 – 100 000 | `Орёл / Решка` |

> 🎯 **Как играть:** отправь эмодзи игры **ответом** на сообщение комнаты или нажми **«Бросить»**.
> При ничьей ставка **возвращается**, а если не сходил 30 секунд — бот сходит за тебя.

---

## 💰 Экономика

```
  Баланс 💰  →  игры 1×1, вывод, переводы, донат
⭐  Очки   ⭐  →  бесплатная игра против бота (новичку — 2000)

🔄  Обмен:    100 💰 → 150 ⭐      |      100 ⭐ → 60 💰
```

---

## 🚀 Быстрый старт

```bash
pip install -r requirements.txt        # 1️⃣ зависимости
cp .env.example .env                   # 2️⃣ токен от @BotFather + ADMIN_IDS
python main.py                         # 3️⃣ запуск
```

### 🐳 Docker — самый простой способ

```bash
docker compose up -d --build           # собрать и запустить бота
docker compose logs -f bot             # смотреть логи
docker compose down                    # остановить
```

> 💡 **Образ не содержит секретов:** `.env` передаётся внутрь через `env_file`,
> база `casino.db` лежит в именованном томе `casino_data` и не теряется при пересборке.
> Контейнер работает под непривилегированным пользователем `bot` (uid 1000).

---

## 📡 Команды

| Команда | Что делает | | Команда | Что делает |
|:--------|:-----------|:-|:--------|:-----------|
| `/start` | 🏠 Главное меню | | `/bot` | 🤖 Играть с ботом ⭐ |
| `/games` | 🎮 Создать комнату | | `/balance` | 💰 Баланс и очки |
| `/convert` | 🔄 Обмен ⭐ ↔ 💰 | | `/history` | 📜 История операций |
| `/stats` | 📊 Моя статистика | | `/top` | 🏆 Топ по балансу |
| `/topbot` | ⭐ Топ по очкам | | `/withdraw` | 💸 Заявка на вывод |
| `/deposit` | 💳 Заявка на пополнение | | `/transfer` | 📤 Перевод баланса |
| `/donate` | 💝 Донат по карте | | `/promo` | 🎁 Активировать промокод |
| `/help` | ❓ Помощь | | `/admin` | 🛠 Админ-панель |

---

## 🛡 Админ-панель `/admin`

| Раздел | Возможности |
|:-------|:------------|
| 📊 Статистика | пользователи, балансы, ставки, активные комнаты |
| ⚙️ Настройки | лимиты, курсы, тайминги и реквизиты доната — без перезапуска |
| 💰 Пополнить баланс | начислить или списать по ID / `@username` |
| 💳 Заявки на пополнение | подтвердить / отклонить |
| 💸 Заявки на вывод | подтвердить / отклонить (при отказе — возврат) |
| 🎁 Промокоды | создать код, сумма, лимит активаций + список |
| 🖼 Баннеры | ручная и авто-рассылка по расписанию |
| 🧾 Все операции | последние транзакции по казино |
---

## ⚙️ Конфигурация

<details>
<summary><b>Показать переменные <code>.env</code></b></summary>

| Переменная | По умолчанию | Описание |
|:-----------|:------------:|:---------|
| `BOT_TOKEN` | — | токен от [@BotFather](https://t.me/BotFather) |
| `ADMIN_IDS` | — | ID админов через запятую |
| `START_BALANCE` | `1000` | 💰 стартовый баланс новичка |
| `START_POINTS` | `2000` | ⭐ стартовые очки для игры с ботом |
| `MIN_BET` / `MAX_BET` | `1` / `1 000 000` | лимиты ставок в 💰 |
| `POINTS_MIN_BET` / `POINTS_MAX_BET` | `10` / `100 000` | лимиты ставок в ⭐ |
| `POINTS_BUY_RATE` | `150` | 100 💰 → N ⭐ |
| `POINTS_SELL_RATE` | `60` | 100 ⭐ → N 💰 |
| `COMMISSION_PERCENT` | `0` | комиссия казино, % |
| `WITHDRAW_MIN` | `1000` | минимальная сумма вывода |
| `WITHDRAW_NOTE` | — | текст о способе выплаты |
| `DONATE_CARD_TYPE` / `_NUMBER` / `_NAME` | — | реквизиты для доната |
| `JOIN_TIMEOUT` | `15` | ожидание соперника, сек |
| `MOVE_TIMEOUT` | `30` | ожидание хода игрока, сек |
| `DICE_ROLL_DELAY` | `3` | имитация броска кубика, сек |
| `RESULT_MSG_TTL` | `15` | авто-удаление результата, сек |
| `BANNER_CHECK_INTERVAL` | `30` | период авто-рассылки баннеров, сек |
| `DB_PATH` | `casino.db` | путь к БД (в Docker — `/app/data/casino.db`) |

> 🧠 Большинство параметров меняется прямо в `/admin → ⚙️ Настройки` и хранится в базе.
</details>

---

## 🏗️ Структура проекта

<details>
<summary><b>Показать дерево</b></summary>

```
CasinoGame/
├── main.py             🚀 точка входа, роутеры, планировщик баннеров
├── config.py           ⚙️ .env + настройки из админки
├── database.py         🗄️ SQLite: пользователи, транзакции, промокоды, заявки, баннеры
├── keyboards.py        🎨 клавиатуры и тексты кнопок
├── utils.py            🛡️ HTML-экранирование и форматирование чисел
├── run_tests.py        🧪 109 смоук-тестов
├── Dockerfile          🐳 production-образ (non-root + healthcheck)
├── docker-compose.yml  🚀 запуск одной командой
├── services/
│   ├── rooms.py        🏠 комнаты 1×1 и игра против бота
│   ├── games.py        📚 справочник игр
│   └── banners.py      📢 рассылка баннеров
└── handlers/
    ├── start.py        🏠 меню, баланс, история, статистика, топы
    ├── rooms.py        🎮 ходы, сдача, таймауты
    ├── convert.py      🔄 обмен ⭐ ↔ 💰
    ├── deposit.py      💳 заявки на пополнение
    ├── withdraw.py     💸 заявки на вывод
    ├── transfer.py     📤 переводы и донат
    ├── promo.py        🎁 промокоды
    ├── banner.py       🖼 админка баннеров
    ├── admin.py        🛠 админ-панель
    └── common.py       🚫 глобальная отмена
```
</details>

---

## 🧪 Тесты

```bash
python run_tests.py        # Windows: set PYTHONIOENCODING=utf-8 && python run_tests.py
```

<div align="center">

![109 tests](https://img.shields.io/badge/Tests-109%20passing-2ea44f?style=for-the-badge&logo=githubactions&logoColor=white)

*Экономика · Промокоды · Переводы · Настройки · Статистика · Баннеры · Игровой цикл · Игра с ботом · Донат*

</div>

---

## ⚠️ Важно

> 🚨 **Только один экземпляр бота.** Второй запуск получит `TelegramConflictError`.
> 🐳 В Docker это решается через `container_name` и `restart: unless-stopped`.
> 🔑 Никогда не коммитьте `.env` — он в `.gitignore` и не копируется в образ.

---

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:f7b32b,50:2575fc,100:6a11cb&height=150&section=footer&text=%D0%A3%D0%B4%D0%B0%D1%87%D0%B8%20%D0%B2%20%D0%B8%D0%B3%D1%80%D0%B5!&fontSize=34&fontColor=ffffff&animation=twinkling" width="100%" alt="footer"/>

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=18&duration=3000&pause=900&color=2575FC&center=true&vCenter=true&width=560&lines=Made+with+%E2%9D%A4+on+aiogram+3;Python+3.12+%C2%B7+SQLite+%C2%B7+Docker" alt="Typing SVG"/>

<sub>🎰 <b>aiogram 3</b> + <b>SQLite</b> · HTML-разметка сообщений · чистый long-polling</sub>

</div>