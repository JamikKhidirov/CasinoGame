import { useCallback, useEffect, useState } from "react";

import { useApp } from "../context/AppContext.jsx";
import { api, getAdminToken, setAdminToken } from "../lib/api.js";
import {
  DEPOSIT_STATUS,
  GAMES,
  STATUS,
  TX_TYPE,
  fmt,
  fmtDate,
  fmtSigned,
} from "../lib/format.js";

const TABS = [
  ["overview", "📊 Обзор"],
  ["users", "👥 Игроки"],
  ["deposits", "💳 Донаты"],
  ["withdrawals", "💸 Выводы"],
  ["transactions", "🧾 Операции"],
  ["settings", "⚙️ Настройки"],
];

export default function AdminPage() {
  const { notify } = useApp();
  const [token, setToken] = useState(getAdminToken());
  const [status, setStatus] = useState(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    let alive = true;
    api
      .anon("/api/admin/status")
      .then((data) => alive && setStatus(data))
      .catch(() => alive && setStatus({ available: false, enabled: false }));
    return () => {
      alive = false;
    };
  }, []);

  const logout = useCallback(() => {
    api.admin("/api/admin/logout", { method: "POST" }).catch(() => {});
    setAdminToken("");
    setToken("");
  }, []);

  const handleError = useCallback(
    (err) => {
      notify(err.message || "Ошибка", "error");
      if (err.status === 401) logout();
    },
    [notify, logout]
  );

  const loginWithCode = async (event) => {
    event.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      const data = await api.anon("/api/admin/login", {
        method: "POST",
        body: { code: code.trim() },
      });
      setAdminToken(data.token);
      setToken(data.token);
      setCode("");
      notify(data.admin ? `Админ-панель открыта: ${data.admin.name}` : "Админ-панель открыта", "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const loginWithPassword = async (event) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    try {
      const data = await api.anon("/api/admin/login", { method: "POST", body: { password } });
      setAdminToken(data.token);
      setToken(data.token);
      setPassword("");
      notify("Админ-панель открыта", "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <section className="card center-card">
        <span className="spinner big" />
        <p className="muted">Проверяем доступ к админ-панели…</p>
      </section>
    );
  }

  if (!status.available) {
    return (
      <section className="card center-card">
        <span className="hero-emoji">🔒</span>
        <h2>Админ-панель недоступна</h2>
        <p className="muted small">
          {status.enabled
            ? "Владелец ещё не настроил админов: добавьте свой Telegram ID в ADMIN_IDS в .env и перезапустите."
            : "Админ-панель отключена настройкой ADMIN_PANEL_ENABLED=0."}
        </p>
        <p className="muted small">
          Управлять ботом по-прежнему можно командой <code>/admin</code> в Telegram.
        </p>
      </section>
    );
  }

  if (!token) {
    return (
      <section className="card center-card">
        <span className="hero-emoji">🛠</span>
        <h2>Вход в админ-панель</h2>
        <p className="muted small">
          Доступ только для администраторов из <code>ADMIN_IDS</code>. Код выдаёт бот — пароль
          знать не нужно.
        </p>

        <ol className="steps">
          <li>Откройте бота в Telegram.</li>
          <li>
            Отправьте <code>/admin</code> и нажмите «🌐 Войти в веб-админку (код)».
          </li>
          <li>Введите одноразовый код ниже.</li>
        </ol>

        <form className="row-form narrow" onSubmit={loginWithCode}>
          <input
            className="input code-input"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="КОД ИЗ БОТА"
            maxLength={12}
            autoComplete="one-time-code"
            disabled={!status.codeLogin}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !code.trim() || !status.codeLogin}
          >
            {busy ? <span className="spinner" /> : "Войти по коду"}
          </button>
        </form>

        {!status.codeLogin ? (
          <p className="muted small">Вход по коду недоступен: ADMIN_IDS не задан.</p>
        ) : null}

        {status.passwordLogin ? (
          <div className="admin-password-fallback">
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? "Скрыть вход по паролю" : "Вход по паролю (запасной)"}
            </button>
            {showPassword ? (
              <form className="row-form narrow" onSubmit={loginWithPassword}>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Пароль администратора"
                  autoComplete="current-password"
                />
                <button type="submit" className="btn btn-ghost" disabled={busy || !password}>
                  Войти
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="section-title">
          <h2>🛠 Админ-панель</h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={logout}>
            Выйти
          </button>
        </div>
        <div className="admin-tabs">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`admin-tab${tab === key ? " is-active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {tab === "overview" ? <Overview onError={handleError} notify={notify} /> : null}
      {tab === "users" ? <Users onError={handleError} notify={notify} /> : null}
      {tab === "deposits" ? <Deposits onError={handleError} notify={notify} /> : null}
      {tab === "withdrawals" ? <Withdrawals onError={handleError} notify={notify} /> : null}
      {tab === "transactions" ? <Transactions onError={handleError} /> : null}
      {tab === "settings" ? <Settings onError={handleError} notify={notify} /> : null}
    </div>
  );
}

function Overview({ onError, notify }) {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.admin("/api/admin/overview"));
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const closeRoom = async (roomId) => {
    if (!window.confirm(`Закрыть комнату ${roomId}?`)) return;
    try {
      await api.admin("/api/admin/close-room", { method: "POST", body: { roomId } });
      notify("Комната закрыта", "success");
      load();
    } catch (err) {
      onError(err);
    }
  };

  const broadcast = async (event) => {
    event.preventDefault();
    if (!message.trim()) return;
    try {
      await api.admin("/api/admin/broadcast", { method: "POST", body: { message } });
      setMessage("");
      notify("Сообщение отправлено на сайт", "success");
    } catch (err) {
      onError(err);
    }
  };

  if (!data) return <span className="spinner" />;

  return (
    <>
      <section className="card">
        <div className="stats-grid">
          <div className="stat-box">
            <span className="muted small">Игроков</span>
            <strong>{fmt(data.totalUsers)}</strong>
          </div>
          <div className="stat-box">
            <span className="muted small">Баланс всех</span>
            <strong>{fmt(data.totalBalance)} 💰</strong>
          </div>
          <div className="stat-box">
            <span className="muted small">Онлайн</span>
            <strong>{fmt(data.online)}</strong>
          </div>
          <div className="stat-box">
            <span className="muted small">Комнат</span>
            <strong>{fmt(data.totalRooms)}</strong>
          </div>
          <div className="stat-box">
            <span className="muted small">Игр всего</span>
            <strong>{fmt(data.totalGames)}</strong>
          </div>
          <div className="stat-box">
            <span className="muted small">Заявок на пополнение</span>
            <strong className={data.pendingDeposits ? "green" : ""}>{fmt(data.pendingDeposits)}</strong>
          </div>
          <div className="stat-box">
            <span className="muted small">Заявок на вывод</span>
            <strong className={data.pendingWithdrawals ? "green" : ""}>
              {fmt(data.pendingWithdrawals)}
            </strong>
          </div>
          <div className="stat-box">
            <span className="muted small">Режим</span>
            <strong>{data.mode === "fun" ? "🎲 Развлечение" : "💼 Бизнес"}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>🎮 Активные комнаты</h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={load}>
            Обновить
          </button>
        </div>
        {data.rooms?.length ? (
          <div className="rooms-grid">
            {data.rooms.map((room) => (
              <div key={room.id} className="room-card static">
                <div className="room-head">
                  <strong>
                    {GAMES[room.gameType]?.icon} {GAMES[room.gameType]?.title}
                  </strong>
                  <span className={`badge ${room.status}`}>{STATUS[room.status]}</span>
                </div>
                <div className="room-meta">
                  <span>Код: {room.id}</span>
                  <span>💰 {fmt(room.bet)}</span>
                  <span>
                    👥 {room.players.length}/{room.maxPlayers}
                  </span>
                </div>
                <button type="button" className="btn btn-danger btn-small" onClick={() => closeRoom(room.id)}>
                  Закрыть
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Комнат нет.</p>
        )}
      </section>

      <section className="card">
        <div className="section-title">
          <h2>📢 Сообщение на сайт</h2>
        </div>
        <form className="row-form" onSubmit={broadcast}>
          <input
            className="input"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Текст для всех игроков"
            maxLength={500}
          />
          <button type="submit" className="btn btn-primary" disabled={!message.trim()}>
            Отправить
          </button>
        </form>
      </section>
    </>
  );
}

function Users({ onError, notify }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [delta, setDelta] = useState(100);
  const [reason, setReason] = useState("Пополнение админом");

  const load = useCallback(
    async (value = "") => {
      try {
        const data = await api.admin(`/api/admin/users?q=${encodeURIComponent(value)}`);
        setRows(data.rows || []);
      } catch (err) {
        onError(err);
      }
    },
    [onError]
  );

  useEffect(() => {
    load("");
  }, [load]);

  const adjust = async (sign) => {
    if (!selected) return;
    const value = Math.abs(Number(delta) || 0) * sign;
    if (!value) return;
    try {
      const data = await api.admin("/api/admin/balance", {
        method: "POST",
        body: { userId: selected.id, delta: value, reason },
      });
      notify(`${selected.first_name || selected.id}: баланс ${fmt(data.balance)}`, "success");
      setSelected({ ...selected, balance: data.balance });
      load(query);
    } catch (err) {
      onError(err);
    }
  };

  return (
    <section className="card">
      <div className="section-title">
        <h2>👥 Игроки</h2>
      </div>
      <form
        className="row-form"
        onSubmit={(event) => {
          event.preventDefault();
          load(query);
        }}
      >
        <input
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ID, имя или @username"
        />
        <button type="submit" className="btn btn-primary">
          Найти
        </button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Имя</th>
              <th>Баланс</th>
              <th>Очки</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={selected?.id === row.id ? "is-me" : ""}>
                <td className="mono">{row.id}</td>
                <td>{row.first_name || row.username || "—"}</td>
                <td>{fmt(row.balance)} 💰</td>
                <td>{fmt(row.points)} ⭐</td>
                <td>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setSelected(row)}>
                    Выбрать
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="adjust-box">
          <strong>
            Начислить / списать: {selected.first_name || selected.id} · сейчас {fmt(selected.balance)} 💰
          </strong>
          <div className="fields-grid">
            <label className="field">
              <span>Сумма 💰</span>
              <input
                className="input"
                type="number"
                min={1}
                value={delta}
                onChange={(event) => setDelta(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Причина</span>
              <input
                className="input"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={200}
              />
            </label>
          </div>
          <div className="actions-row">
            <button type="button" className="btn btn-primary" onClick={() => adjust(1)}>
              + Начислить
            </button>
            <button type="button" className="btn btn-danger" onClick={() => adjust(-1)}>
              − Списать
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>
              Отмена
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Deposits({ onError, notify }) {
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState([]);

  const load = useCallback(
    async (value = status) => {
      try {
        const data = await api.admin(`/api/admin/deposits?status=${value}`);
        setRows(data.rows || []);
      } catch (err) {
        onError(err);
      }
    },
    [status, onError]
  );

  useEffect(() => {
    load(status);
  }, [status, load]);

  const resolve = async (id, approve) => {
    try {
      await api.admin(`/api/admin/deposits/${id}/resolve`, {
        method: "POST",
        body: { approve },
      });
      notify(approve ? "Пополнение подтверждено" : "Заявка отклонена", "success");
      load(status);
    } catch (err) {
      onError(err);
    }
  };

  return (
    <section className="card">
      <div className="section-title">
        <h2>💳 Заявки на пополнение</h2>
        <StatusFilter value={status} onChange={setStatus} />
      </div>
      {rows.length ? (
        <ul className="plain-list">
          {rows.map((row) => (
            <li key={row.id}>
              <span>
                #{row.id} · {row.name || row.user_id}
                <span className="muted small">
                  {" "}
                  · {fmtDate(row.created_at)} · {row.source === "site" ? "сайт" : "бот"}
                  {row.comment ? ` · ${row.comment}` : ""}
                </span>
              </span>
              <span className="inline">
                <strong>{fmt(row.amount)} 💰</strong>
                {row.status === "pending" ? (
                  <>
                    <button type="button" className="btn btn-primary btn-small" onClick={() => resolve(row.id, true)}>
                      Зачислить
                    </button>
                    <button type="button" className="btn btn-danger btn-small" onClick={() => resolve(row.id, false)}>
                      Отклонить
                    </button>
                  </>
                ) : (
                  <span className={`badge ${row.status}`}>{DEPOSIT_STATUS[row.status] || row.status}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Заявок нет.</p>
      )}
    </section>
  );
}

function Withdrawals({ onError, notify }) {
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState([]);

  const load = useCallback(
    async (value = status) => {
      try {
        const data = await api.admin(`/api/admin/withdrawals?status=${value}`);
        setRows(data.rows || []);
      } catch (err) {
        onError(err);
      }
    },
    [status, onError]
  );

  useEffect(() => {
    load(status);
  }, [status, load]);

  const resolve = async (id, approve) => {
    try {
      await api.admin(`/api/admin/withdrawals/${id}/resolve`, {
        method: "POST",
        body: { approve },
      });
      notify(approve ? "Вывод подтверждён" : "Заявка отклонена, средства возвращены", "success");
      load(status);
    } catch (err) {
      onError(err);
    }
  };

  const copy = async (value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      notify("Реквизиты скопированы", "success");
    } catch {
      notify(value, "info");
    }
  };

  return (
    <section className="card">
      <div className="section-title">
        <h2>💸 Заявки на вывод</h2>
        <StatusFilter value={status} onChange={setStatus} />
      </div>
      {rows.length ? (
        <ul className="plain-list">
          {rows.map((row) => (
            <li key={row.id}>
              <span>
                #{row.id} · {row.name || row.user_id}
                <span className="muted small">
                  {" "}
                  · {fmtDate(row.created_at)} · {row.source === "site" ? "сайт" : "бот"}
                </span>
                <span className="payout-line">
                  {row.payout_method === "account" ? "🏦 Счёт" : "💳 Карта"}:{" "}
                  <strong className="mono">{row.payout_target || "не указано"}</strong>
                  {row.payout_name ? ` · ${row.payout_name}` : ""}
                  {row.payout_bank ? ` · ${row.payout_bank}` : ""}
                  {row.payout_target ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={() => copy(row.payout_target)}
                    >
                      Копировать
                    </button>
                  ) : null}
                </span>
              </span>
              <span className="inline">
                <strong>{fmt(row.amount)} 💰</strong>
                {row.status === "pending" ? (
                  <>
                    <button type="button" className="btn btn-primary btn-small" onClick={() => resolve(row.id, true)}>
                      Выплачено
                    </button>
                    <button type="button" className="btn btn-danger btn-small" onClick={() => resolve(row.id, false)}>
                      Отклонить
                    </button>
                  </>
                ) : (
                  <span className={`badge ${row.status}`}>{DEPOSIT_STATUS[row.status] || row.status}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Заявок нет.</p>
      )}
    </section>
  );
}

function Transactions({ onError }) {
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    try {
      const data = await api.admin("/api/admin/transactions");
      setRows(data.rows || []);
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="card">
      <div className="section-title">
        <h2>🧾 Последние операции</h2>
        <button type="button" className="btn btn-ghost btn-small" onClick={load}>
          Обновить
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Игрок</th>
              <th>Тип</th>
              <th>Сумма</th>
              <th>Дата</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.name || row.user_id}</td>
                <td>{TX_TYPE[row.type] || row.type}</td>
                <td className={row.amount > 0 ? "green" : "red"}>{fmtSigned(row.amount)}</td>
                <td className="muted small">{fmtDate(row.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Settings({ onError, notify }) {
  const { refreshMode } = useApp();
  const [form, setForm] = useState({
    mode: "business",
    cardType: "",
    cardNumber: "",
    cardName: "",
    note: "",
    withdrawMin: 1000,
    withdrawNote: "",
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.admin("/api/admin/settings");
      setForm({
        mode: data.mode === "fun" ? "fun" : "business",
        cardType: data.cardType || "",
        cardNumber: data.cardNumber || "",
        cardName: data.cardName || "",
        note: data.note || "",
        withdrawMin: data.withdrawMin || 1000,
        withdrawNote: data.withdrawNote || "",
      });
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.admin("/api/admin/settings", { method: "PUT", body: form });
      await refreshMode();
      notify(
        form.mode === "fun"
          ? "Режим «Развлечение» включён: донаты и выводы отключены"
          : "Режим «Бизнес» включён: донаты и выводы доступны",
        "success"
      );
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  return (
    <section className="card">
      <div className="section-title">
        <h2>⚙️ Режим и реквизиты</h2>
      </div>
      <form className="stack" onSubmit={save}>
        <div className="mode-box">
          <strong>Режим работы сайта</strong>
          <p className="muted small">
            «Бизнес» — можно пополнять баланс и выводить деньги. «Развлечение» — только игра
            ради веселья, донаты и выводы отключены и скрыты у игроков.
          </p>
          <div className="segmented">
            <button
              type="button"
              className={form.mode === "business" ? "is-active" : ""}
              onClick={() => setForm((current) => ({ ...current, mode: "business" }))}
            >
              💼 Бизнес
            </button>
            <button
              type="button"
              className={form.mode === "fun" ? "is-active" : ""}
              onClick={() => setForm((current) => ({ ...current, mode: "fun" }))}
            >
              🎲 Развлечение
            </button>
          </div>
        </div>

        <h3 className="form-subtitle">Реквизиты для пополнения</h3>
        <label className="field">
          <span>Банк / тип карты</span>
          <input className="input" value={form.cardType} onChange={set("cardType")} />
        </label>
        <label className="field">
          <span>Номер карты</span>
          <input className="input mono" value={form.cardNumber} onChange={set("cardNumber")} />
        </label>
        <label className="field">
          <span>Получатель (ФИО)</span>
          <input className="input" value={form.cardName} onChange={set("cardName")} />
        </label>
        <label className="field">
          <span>Подсказка на странице пополнения</span>
          <input className="input" value={form.note} onChange={set("note")} />
        </label>

        <h3 className="form-subtitle">Вывод средств</h3>
        <label className="field">
          <span>Минимальная сумма вывода, 💰</span>
          <input
            className="input"
            type="number"
            min={1}
            value={form.withdrawMin}
            onChange={set("withdrawMin")}
          />
        </label>
        <label className="field">
          <span>Подсказка при выводе (карта или счёт)</span>
          <input className="input" value={form.withdrawNote} onChange={set("withdrawNote")} />
        </label>

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <span className="spinner" /> : "Сохранить настройки"}
        </button>
      </form>
    </section>
  );
}

function StatusFilter({ value, onChange }) {
  return (
    <div className="segmented">
      {[
        ["pending", "Ожидают"],
        ["approved", "Одобрены"],
        ["rejected", "Отклонены"],
      ].map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={value === key ? "is-active" : ""}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
