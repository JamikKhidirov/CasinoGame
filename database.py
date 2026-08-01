import sqlite3
import threading
import time

import config

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
    return _conn


def init_db() -> None:
    with _lock:
        conn = _get_conn()
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT,
                first_name TEXT,
                balance INTEGER NOT NULL DEFAULT 0,
                points INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                type TEXT NOT NULL,
                description TEXT,
                admin_id INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS promocodes (
                code TEXT PRIMARY KEY,
                amount INTEGER NOT NULL,
                max_uses INTEGER NOT NULL,
                used_count INTEGER NOT NULL DEFAULT 0,
                created_by INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS promo_uses (
                code TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (code, user_id)
            );

            CREATE TABLE IF NOT EXISTS withdrawals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at INTEGER NOT NULL,
                processed_at INTEGER,
                admin_id INTEGER
            );

            CREATE TABLE IF NOT EXISTS deposits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at INTEGER NOT NULL,
                processed_at INTEGER,
                admin_id INTEGER
            );

            CREATE TABLE IF NOT EXISTS banners (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                title TEXT,
                text TEXT,
                photo TEXT,
                button_text TEXT,
                button_url TEXT,
                interval_minutes INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                last_sent_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS banner_sends (
                banner_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (banner_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS game_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                game_key TEXT NOT NULL,
                bet INTEGER NOT NULL,
                result TEXT NOT NULL,
                amount INTEGER NOT NULL,
                opponent TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions (user_id, id);
            CREATE INDEX IF NOT EXISTS idx_stats_user ON game_stats (user_id, id);
            CREATE INDEX IF NOT EXISTS idx_wd_status ON withdrawals (status);
            """
        )
        conn.commit()

        # миграция: колонка points для старых баз
        cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "points" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0")
            conn.commit()


# ============ Настройки (правятся админом из панели) ============

def get_all_settings() -> dict[str, str]:
    with _lock:
        rows = _get_conn().execute("SELECT key, value FROM settings").fetchall()
        return {r["key"]: r["value"] for r in rows}


def set_setting(key: str, value: str) -> None:
    with _lock:
        _get_conn().execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (key, value, int(time.time())),
        )
        _get_conn().commit()


# ============ Пользователи ============

def get_user(user_id: int) -> dict | None:
    with _lock:
        row = _get_conn().execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return dict(row) if row else None


def ensure_user(user_id: int, username: str | None = None, first_name: str | None = None) -> dict:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT OR IGNORE INTO users (id, username, first_name, balance, points, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, username, first_name, config.START_BALANCE, config.START_POINTS, int(time.time())),
        )
        conn.execute(
            "UPDATE users SET username=?, first_name=? WHERE id=?",
            (username, first_name, user_id),
        )
        conn.commit()
        return get_user(user_id)


def get_balance(user_id: int) -> int:
    user = get_user(user_id)
    return user["balance"] if user else 0


def get_points(user_id: int) -> int:
    user = get_user(user_id)
    return user["points"] if user else 0


def change_points(user_id: int, delta: int, tx_type: str, description: str,
                  admin_id: int | None = None) -> int | None:
    """Изменяет очки бота и пишет транзакцию. Возвращает новые очки или None."""
    with _lock:
        conn = _get_conn()
        cur = conn.execute("SELECT points FROM users WHERE id=?", (user_id,))
        row = cur.fetchone()
        if row is None:
            return None
        new_points = row["points"] + delta
        conn.execute("UPDATE users SET points=? WHERE id=?", (new_points, user_id))
        conn.execute(
            "INSERT INTO transactions (user_id, amount, type, description, admin_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, delta, tx_type, description, admin_id, int(time.time())),
        )
        conn.commit()
        return new_points


def add_points(user_id: int, delta: int, tx_type: str, description: str,
               admin_id: int | None = None) -> int | None:
    return change_points(user_id, delta, tx_type, description, admin_id=admin_id)


def deduct_points(user_id: int, amount: int, description: str) -> int | None:
    """Списывает очки. Возвращает новые очки или None, если не хватает."""
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT points FROM users WHERE id=?", (user_id,)).fetchone()
        if row is None or row["points"] < amount:
            return None
        return change_points(user_id, -amount, "points_bet", description)


def change_balance(user_id: int, delta: int, tx_type: str, description: str, admin_id: int | None = None) -> int | None:
    """Изменяет баланс и пишет транзакцию. Возвращает новый баланс или None."""
    with _lock:
        conn = _get_conn()
        cur = conn.execute("SELECT balance FROM users WHERE id=?", (user_id,))
        row = cur.fetchone()
        if row is None:
            return None
        new_balance = row["balance"] + delta
        conn.execute("UPDATE users SET balance=? WHERE id=?", (new_balance, user_id))
        conn.execute(
            "INSERT INTO transactions (user_id, amount, type, description, admin_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, delta, tx_type, description, admin_id, int(time.time())),
        )
        conn.commit()
        return new_balance


def add_balance(user_id: int, delta: int, tx_type: str, description: str,
                admin_id: int | None = None) -> int | None:
    """Изменяет баланс (положительное или отрицательное значение) и пишет транзакцию."""
    return change_balance(user_id, delta, tx_type, description, admin_id=admin_id)


def deduct(user_id: int, amount: int, description: str) -> int | None:
    """Списывает средства. Возвращает новый баланс или None, если не хватает."""
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT balance FROM users WHERE id=?", (user_id,)).fetchone()
        if row is None or row["balance"] < amount:
            return None
        return change_balance(user_id, -amount, "bet", description)


def find_user(query: str) -> dict | None:
    """Поиск по ID или @username."""
    query = query.strip()
    with _lock:
        conn = _get_conn()
        if query.lstrip("-").isdigit():
            row = conn.execute("SELECT * FROM users WHERE id=?", (int(query),)).fetchone()
        else:
            uname = query.lstrip("@").lower()
            row = conn.execute(
                "SELECT * FROM users WHERE lower(username)=?", (uname,)
            ).fetchone()
        return dict(row) if row else None


# ============ Транзакции ============

def get_transactions(user_id: int, limit: int = 15) -> list[dict]:
    with _lock:
        rows = _get_conn().execute(
            "SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def get_all_transactions(limit: int = 30) -> list[dict]:
    with _lock:
        rows = _get_conn().execute(
            "SELECT t.*, u.username FROM transactions t "
            "LEFT JOIN users u ON u.id = t.user_id "
            "ORDER BY t.id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


# ============ Промокоды ============

def create_promocode(code: str, amount: int, max_uses: int, created_by: int) -> bool:
    with _lock:
        try:
            _get_conn().execute(
                "INSERT INTO promocodes (code, amount, max_uses, created_by, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (code.upper(), amount, max_uses, created_by, int(time.time())),
            )
            _get_conn().commit()
            return True
        except sqlite3.IntegrityError:
            return False


def get_promocode(code: str) -> dict | None:
    with _lock:
        row = _get_conn().execute(
            "SELECT * FROM promocodes WHERE code=?", (code.upper(),)
        ).fetchone()
        return dict(row) if row else None


def get_all_promocodes() -> list[dict]:
    with _lock:
        rows = _get_conn().execute(
            "SELECT * FROM promocodes ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def claim_promocode(code: str, user_id: int) -> str:
    """Возвращает 'ok' | 'not_found' | 'already' | 'exhausted'."""
    code = code.strip().upper()
    with _lock:
        conn = _get_conn()
        pc = conn.execute("SELECT * FROM promocodes WHERE code=?", (code,)).fetchone()
        if pc is None:
            return "not_found"
        if pc["used_count"] >= pc["max_uses"]:
            return "exhausted"
        used = conn.execute(
            "SELECT 1 FROM promo_uses WHERE code=? AND user_id=?", (code, user_id)
        ).fetchone()
        if used:
            return "already"
        conn.execute(
            "INSERT INTO promo_uses (code, user_id, created_at) VALUES (?, ?, ?)",
            (code, user_id, int(time.time())),
        )
        conn.execute(
            "UPDATE promocodes SET used_count = used_count + 1 WHERE code=?", (code,)
        )
        conn.execute(
            "UPDATE users SET balance = balance + ? WHERE id=?", (pc["amount"], user_id)
        )
        conn.execute(
            "INSERT INTO transactions (user_id, amount, type, description, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (user_id, pc["amount"], "promo", f"Промокод {code}", int(time.time())),
        )
        conn.commit()
        return "ok"


# ============ Статистика ============

def get_stats() -> dict:
    with _lock:
        conn = _get_conn()
        users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        total_balance = conn.execute(
            "SELECT COALESCE(SUM(balance), 0) FROM users"
        ).fetchone()[0]
        deposits = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type='deposit'"
        ).fetchone()[0]
        withdrawals = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type='withdraw'"
        ).fetchone()[0]
        promo_total = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type='promo'"
        ).fetchone()[0]
        bets = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE type='bet'"
        ).fetchone()[0]
        wins = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE type='win'"
        ).fetchone()[0]
        return {
            "users": users,
            "total_balance": total_balance,
            "deposits": deposits,
            "withdrawals": withdrawals,
            "promo_total": promo_total,
            "bets": bets,
            "wins": wins,
        }


# ============ Статистика игр ============

def record_game(user_id: int, game_key: str, bet: int, result: str,
                amount: int, opponent: str) -> None:
    with _lock:
        _get_conn().execute(
            "INSERT INTO game_stats (user_id, game_key, bet, result, amount, opponent, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, game_key, bet, result, amount, opponent, int(time.time())),
        )
        _get_conn().commit()


def get_user_stats(user_id: int) -> dict:
    with _lock:
        conn = _get_conn()
        total = conn.execute(
            "SELECT COUNT(*) FROM game_stats WHERE user_id=?", (user_id,)
        ).fetchone()[0]
        wins = conn.execute(
            "SELECT COUNT(*) FROM game_stats WHERE user_id=? AND result='win'", (user_id,)
        ).fetchone()[0]
        losses = conn.execute(
            "SELECT COUNT(*) FROM game_stats WHERE user_id=? AND result='lose'", (user_id,)
        ).fetchone()[0]
        ties = conn.execute(
            "SELECT COUNT(*) FROM game_stats WHERE user_id=? AND result='tie'", (user_id,)
        ).fetchone()[0]
        total_won = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM game_stats WHERE user_id=? AND result='win'",
            (user_id,),
        ).fetchone()[0]
        total_lost = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM game_stats WHERE user_id=? AND result='lose'",
            (user_id,),
        ).fetchone()[0]
        by_game = conn.execute(
            "SELECT game_key, COUNT(*) as cnt FROM game_stats WHERE user_id=? GROUP BY game_key ORDER BY cnt DESC",
            (user_id,),
        ).fetchall()
        favorite = dict(by_game[0]) if by_game else None
        game_breakdown = [dict(r) for r in by_game]
        return {
            "total": total,
            "wins": wins,
            "losses": losses,
            "ties": ties,
            "total_won": total_won,
            "total_lost": total_lost,
            "net": total_won + total_lost,
            "favorite": favorite,
            "by_game": game_breakdown,
        }


def get_top_users(limit: int = 10) -> list[dict]:
    with _lock:
        rows = _get_conn().execute(
            "SELECT * FROM users ORDER BY balance DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_top_points(limit: int = 10) -> list[dict]:
    with _lock:
        rows = _get_conn().execute(
            "SELECT * FROM users ORDER BY points DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


# ============ Выводы ============

def create_withdrawal(user_id: int, amount: int) -> int:
    with _lock:
        cur = _get_conn().execute(
            "INSERT INTO withdrawals (user_id, amount, status, created_at) VALUES (?, ?, 'pending', ?)",
            (user_id, amount, int(time.time())),
        )
        _get_conn().commit()
        return cur.lastrowid


def get_pending_withdrawals() -> list[dict]:
    with _lock:
        rows = _get_conn().execute(
            "SELECT * FROM withdrawals WHERE status='pending' ORDER BY id ASC"
        ).fetchall()
        return [dict(r) for r in rows]


def get_user_withdrawals(user_id: int, limit: int = 10) -> list[dict]:
    with _lock:
        rows = _get_conn().execute(
            "SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def resolve_withdrawal(wid: int, status: str, admin_id: int) -> dict | None:
    """При approve средства остаются списанными (выплачены).
    При reject сумма возвращается на баланс."""
    with _lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT * FROM withdrawals WHERE id=? AND status='pending'", (wid,)
        ).fetchone()
        if row is None:
            return None
        ts = int(time.time())
        if status == "rejected":
            conn.execute(
                "UPDATE users SET balance = balance + ? WHERE id=?", (row["amount"], row["user_id"])
            )
            conn.execute(
                "INSERT INTO transactions (user_id, amount, type, description, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (row["user_id"], row["amount"], "refund", f"Отклонение заявки на вывод #{wid}", ts),
            )
        conn.execute(
            "UPDATE withdrawals SET status=?, processed_at=?, admin_id=? WHERE id=?",
            (status, ts, admin_id, wid),
        )
        conn.commit()
        return dict(row)


# ============ Пополнения ============

def create_deposit(user_id: int, amount: int) -> int:
    with _lock:
        cur = _get_conn().execute(
            "INSERT INTO deposits (user_id, amount, status, created_at) VALUES (?, ?, 'pending', ?)",
            (user_id, amount, int(time.time())),
        )
        _get_conn().commit()
        return cur.lastrowid


def get_pending_deposits() -> list[dict]:
    with _lock:
        rows = _get_conn().execute(
            "SELECT * FROM deposits WHERE status='pending' ORDER BY id ASC"
        ).fetchall()
        return [dict(r) for r in rows]


def get_user_deposits(user_id: int, limit: int = 10) -> list[dict]:
    with _lock:
        rows = _get_conn().execute(
            "SELECT * FROM deposits WHERE user_id=? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def resolve_deposit(did: int, approved: bool, admin_id: int) -> dict | None:
    """При approve начисляем баланс, при reject просто закрываем заявку."""
    with _lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT * FROM deposits WHERE id=? AND status='pending'", (did,)
        ).fetchone()
        if row is None:
            return None
        ts = int(time.time())
        status = "approved" if approved else "rejected"
        if approved:
            conn.execute(
                "UPDATE users SET balance = balance + ? WHERE id=?",
                (row["amount"], row["user_id"]),
            )
            conn.execute(
                "INSERT INTO transactions (user_id, amount, type, description, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (row["user_id"], row["amount"], "deposit", f"Пополнение баланса #{did}", ts),
            )
        conn.execute(
            "UPDATE deposits SET status=?, processed_at=?, admin_id=? WHERE id=?",
            (status, ts, admin_id, did),
        )
        conn.commit()
        return dict(row)


# ============ Переводы ============

def transfer(sender_id: int, receiver_id: int, amount: int) -> bool:
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT balance FROM users WHERE id=?", (sender_id,)).fetchone()
        if row is None or row["balance"] < amount:
            return False
        ts = int(time.time())
        conn.execute("UPDATE users SET balance = balance - ? WHERE id=?", (amount, sender_id))
        conn.execute("UPDATE users SET balance = balance + ? WHERE id=?", (amount, receiver_id))
        conn.execute(
            "INSERT INTO transactions (user_id, amount, type, description, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (sender_id, -amount, "transfer", f"Перевод игроку {receiver_id}", ts),
        )
        conn.execute(
            "INSERT INTO transactions (user_id, amount, type, description, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (receiver_id, amount, "transfer", f"Перевод от игрока {sender_id}", ts),
        )
        conn.commit()
        return True


# ============ Баннеры ============

def create_banner(name: str, title: str | None, text: str | None, photo: str | None,
                  button_text: str | None, button_url: str | None, interval_minutes: int) -> int:
    with _lock:
        cur = _get_conn().execute(
            "INSERT INTO banners (name, title, text, photo, button_text, button_url, interval_minutes, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (name, title, text, photo, button_text, button_url, interval_minutes, int(time.time())),
        )
        _get_conn().commit()
        return cur.lastrowid


def get_banner(bid: int) -> dict | None:
    with _lock:
        row = _get_conn().execute("SELECT * FROM banners WHERE id=?", (bid,)).fetchone()
        return dict(row) if row else None


def get_all_banners() -> list[dict]:
    with _lock:
        rows = _get_conn().execute("SELECT * FROM banners ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]


def delete_banner(bid: int) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute("DELETE FROM banners WHERE id=?", (bid,))
        conn.execute("DELETE FROM banner_sends WHERE banner_id=?", (bid,))
        conn.commit()


def set_banner_enabled(bid: int, enabled: bool) -> None:
    with _lock:
        _get_conn().execute(
            "UPDATE banners SET enabled=? WHERE id=?", (1 if enabled else 0, bid)
        )
        _get_conn().commit()


def mark_banner_sent(bid: int, ts: int) -> None:
    with _lock:
        _get_conn().execute("UPDATE banners SET last_sent_at=? WHERE id=?", (ts, bid))
        _get_conn().commit()


def get_due_banners(now: int | None = None) -> list[dict]:
    """Баннеры с включённой авто-рассылкой, у которых наступил интервал."""
    now = now or int(time.time())
    with _lock:
        rows = _get_conn().execute(
            "SELECT * FROM banners WHERE enabled=1 AND interval_minutes>0"
        ).fetchall()
        due = []
        for r in rows:
            last = r["last_sent_at"] or 0
            if now - last >= r["interval_minutes"] * 60:
                due.append(dict(r))
        return due


def get_all_user_ids() -> list[int]:
    with _lock:
        rows = _get_conn().execute("SELECT id FROM users").fetchall()
        return [int(r["id"]) for r in rows]


def user_received_banner(banner_id: int, user_id: int) -> bool:
    with _lock:
        row = _get_conn().execute(
            "SELECT 1 FROM banner_sends WHERE banner_id=? AND user_id=?",
            (banner_id, user_id),
        ).fetchone()
        return row is not None


def record_banner_send(banner_id: int, user_id: int) -> None:
    with _lock:
        _get_conn().execute(
            "INSERT OR IGNORE INTO banner_sends (banner_id, user_id, created_at) VALUES (?, ?, ?)",
            (banner_id, user_id, int(time.time())),
        )
        _get_conn().commit()
