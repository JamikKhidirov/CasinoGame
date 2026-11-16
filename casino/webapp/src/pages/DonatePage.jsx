import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useApp } from "../context/AppContext.jsx";
import { api } from "../lib/api.js";
import { DEPOSIT_STATUS, fmt, fmtDate } from "../lib/format.js";

const PRESETS = [100, 300, 500, 1000, 3000];

export default function DonatePage() {
  const { user, notify, refresh } = useApp();
  const [info, setInfo] = useState(null);
  const [amount, setAmount] = useState(500);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.me("/api/donate/info");
      setInfo(data);
      if (data?.min) setAmount((current) => Math.max(Number(current) || 0, data.min));
    } catch (err) {
      notify(err.message, "error");
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
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

  const copyCard = async () => {
    if (!info?.cardNumber) return;
    try {
      await navigator.clipboard.writeText(info.cardNumber);
      notify("Номер карты скопирован", "success");
    } catch {
      notify(`Карта: ${info.cardNumber}`, "info");
    }
  };

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

      {user ? (
        <section className="card">
          <div className="section-title">
            <h2>🧾 Мои заявки</h2>
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
      ) : null}

      <section className="card muted small">
        <strong>Как это работает</strong>
        <p>
          1. Переведите сумму на карту. 2. Отправьте заявку на сайте или командой <code>/deposit</code> в
          боте. 3. Админ подтверждает — монеты зачисляются на общий кошелёк (баланс в боте и на сайте
          один и тот же).
        </p>
      </section>
    </div>
  );
}
