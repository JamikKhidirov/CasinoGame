import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useApp } from "../context/AppContext.jsx";
import { api } from "../lib/api.js";
import { DEPOSIT_STATUS, fmt, fmtDate } from "../lib/format.js";

const PRESETS = [100, 300, 500, 1000, 3000];

function maskTarget(value) {
  const text = String(value || "");
  if (text.length <= 4) return text;
  return `•••• ${text.slice(-4)}`;
}

export default function DonatePage() {
  const { user, business, notify, refresh, refreshMode } = useApp();
  const [info, setInfo] = useState(null);
  const [amount, setAmount] = useState(500);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const [withdrawAmount, setWithdrawAmount] = useState(1000);
  const [method, setMethod] = useState("card");
  const [target, setTarget] = useState("");
  const [holder, setHolder] = useState("");
  const [bank, setBank] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.me("/api/donate/info");
      setInfo(data);
      if (data?.min) setAmount((current) => Math.max(Number(current) || 0, data.min));
      if (data?.mode) refreshMode();
    } catch (err) {
      notify(err.message, "error");
    }
  }, [notify, refreshMode]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (info?.withdrawMin) {
      setWithdrawAmount((current) => Math.max(Number(current) || 0, info.withdrawMin));
    }
  }, [info?.withdrawMin]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !business) return;
    setBusy(true);
    try {
      await api.me("/api/donate", {
        method: "POST",
        body: { amount: Number(amount), comment },
      });
      notify("Заявка отправлена — админ подтвердит пополнение", "success");
      setComment("");
      await load();
      await refresh();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const submitWithdraw = async (event) => {
    event.preventDefault();
    if (withdrawBusy || !business) return;
    setWithdrawBusy(true);
    try {
      const data = await api.me("/api/withdraw", {
        method: "POST",
        body: {
          amount: Number(withdrawAmount),
          method,
          target,
          holder,
          bank,
        },
      });
      notify(`Заявка на вывод #${data.id} создана — средства заморожены`, "success");
      setTarget("");
      setHolder("");
      setBank("");
      await load();
      await refresh();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setWithdrawBusy(false);
    }
  };

  const copyCard = async () => {
    if (!info?.cardNumber) return;
    try {
      await navigator.clipboard.writeText(info.cardNumber);
      notify("Номер карты скопирован", "success");
    } catch {
      notify(`Карта: ${info.cardNumber}`, "info");
    }
  };

  if (!business) {
    return (
      <div className="stack">
        <section className="card center-card">
          <span className="hero-emoji">🎲</span>
          <h2>Режим «Развлечение»</h2>
          <p className="muted">
            Сейчас играем только ради веселья: пополнения, донаты и вывод денег отключены.
          </p>
          <p className="muted small">
            Монеты и очки остаются на балансе — играть можно как обычно. Когда владелец включит
            режим «Бизнес», здесь снова появятся пополнение и вывод.
          </p>
          <Link to="/" className="btn btn-primary">
            🎮 Играть
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="section-title">
          <h2>💳 Пополнение баланса</h2>
          {user ? <span className="chip">💳 {fmt(user.balance)}</span> : null}
        </div>

        {!user ? (
          <p className="muted">
            Донат привязывается к аккаунту. <Link to="/#account">Войдите по коду из Telegram</Link>,
            чтобы отправить заявку и получить монеты на общий кошелёк.
          </p>
        ) : null}

        <div className="donate-card">
          <div className="donate-row">
            <span className="muted small">Банк</span>
            <strong>{info?.cardType || "—"}</strong>
          </div>
          <div className="donate-row">
            <span className="muted small">Номер карты</span>
            <div className="inline">
              <strong className="mono">{info?.cardNumber || "не задан"}</strong>
              {info?.cardNumber ? (
                <button type="button" className="btn btn-ghost btn-small" onClick={copyCard}>
                  Копировать
                </button>
              ) : null}
            </div>
          </div>
          <div className="donate-row">
            <span className="muted small">Получатель</span>
            <strong>{info?.cardName || "—"}</strong>
          </div>
        </div>

        <p className="muted small">{info?.note}</p>

        <form className="stack" onSubmit={submit}>
          <div className="preset-row">
            {PRESETS.map((value) => (
              <button
                key={value}
                type="button"
                className={`preset${Number(amount) === value ? " is-active" : ""}`}
                onClick={() => setAmount(value)}
              >
                {fmt(value)}
              </button>
            ))}
          </div>
          <label className="field">
            <span>Сумма пополнения, 💰 (от {fmt(info?.min || 100)})</span>
            <input
              className="input"
              type="number"
              min={info?.min || 1}
              max={info?.max}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={!user}
            />
          </label>
          <label className="field">
            <span>Комментарий к переводу (необязательно)</span>
            <input
              className="input"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={200}
              placeholder="Например: последние 4 цифры карты"
              disabled={!user}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!user || busy}>
            {busy ? <span className="spinner" /> : "Отправить заявку"}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>💸 Вывод на карту или счёт</h2>
          {user ? <span className="chip">💳 {fmt(user.balance)}</span> : null}
        </div>
        <p className="muted small">
          Укажите реквизиты — администратор переведёт деньги и подтвердит заявку. Сумма
          замораживается на балансе до решения.
        </p>

        <form className="stack" onSubmit={submitWithdraw}>
          <div className="fields-grid">
            <label className="field">
              <span>Куда вывести</span>
              <select
                className="input"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                disabled={!user}
              >
                {(info?.methods || [
                  { key: "card", label: "Банковская карта" },
                  { key: "account", label: "Банковский счёт" },
                ]).map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Сумма вывода, 💰 (от {fmt(info?.withdrawMin || 1000)})</span>
              <input
                className="input"
                type="number"
                min={info?.withdrawMin || 1}
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value)}
                disabled={!user}
              />
            </label>
          </div>

          <label className="field">
            <span>{method === "card" ? "Номер карты" : "Номер счёта"}</span>
            <input
              className="input mono"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder={method === "card" ? "2202 2000 0000 0000" : "40817810000000000000"}
              inputMode="numeric"
              autoComplete="off"
              maxLength={40}
              disabled={!user}
            />
          </label>

          <div className="fields-grid">
            <label className="field">
              <span>Имя получателя</span>
              <input
                className="input"
                value={holder}
                onChange={(event) => setHolder(event.target.value)}
                placeholder="Иванов Иван Иванович"
                maxLength={80}
                disabled={!user}
              />
            </label>
            <label className="field">
              <span>Банк (необязательно)</span>
              <input
                className="input"
                value={bank}
                onChange={(event) => setBank(event.target.value)}
                placeholder="Сбербанк / Т-Банк"
                maxLength={80}
                disabled={!user}
              />
            </label>
          </div>

          <p className="muted small">{info?.withdrawNote}</p>

          <button type="submit" className="btn btn-primary" disabled={!user || withdrawBusy}>
            {withdrawBusy ? <span className="spinner" /> : "Отправить заявку на вывод"}
          </button>
        </form>
      </section>

      {user ? (
        <>
          <section className="card">
            <div className="section-title">
              <h2>🧾 Мои пополнения</h2>
              <button type="button" className="btn btn-ghost btn-small" onClick={load}>
                Обновить
              </button>
            </div>
            {info?.deposits?.length ? (
              <ul className="plain-list">
                {info.deposits.map((deposit) => (
                  <li key={deposit.id}>
                    <span>
                      #{deposit.id} · {fmtDate(deposit.created_at)}
                      <span className="muted small"> · {deposit.source === "site" ? "сайт" : "бот"}</span>
                    </span>
                    <span className="inline">
                      <strong>{fmt(deposit.amount)} 💰</strong>
                      <span className={`badge ${deposit.status}`}>
                        {DEPOSIT_STATUS[deposit.status] || deposit.status}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Заявок пока нет.</p>
            )}
          </section>

          <section className="card">
            <div className="section-title">
              <h2>💸 Мои выводы</h2>
              <button type="button" className="btn btn-ghost btn-small" onClick={load}>
                Обновить
              </button>
            </div>
            {info?.withdrawals?.length ? (
              <ul className="plain-list">
                {info.withdrawals.map((row) => (
                  <li key={row.id}>
                    <span>
                      #{row.id} · {fmtDate(row.created_at)}
                      <span className="muted small">
                        {" "}
                        · {row.payout_method === "account" ? "счёт" : "карта"}{" "}
                        {maskTarget(row.payout_target)}
                        {row.payout_bank ? ` · ${row.payout_bank}` : ""}
                      </span>
                    </span>
                    <span className="inline">
                      <strong>{fmt(row.amount)} 💰</strong>
                      <span className={`badge ${row.status}`}>
                        {DEPOSIT_STATUS[row.status] || row.status}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Заявок на вывод пока нет.</p>
            )}
          </section>
        </>
      ) : null}

      <section className="card muted small">
        <strong>Как это работает</strong>
        <p>
          1. Для пополнения переведите сумму на карту и отправьте заявку. 2. Для вывода укажите
          номер карты или счёта и имя получателя. 3. Админ проверит заявку: пополнение зачислит,
          а по выводу переведёт деньги и подтвердит выплату.
        </p>
      </section>
    </div>
  );
}
