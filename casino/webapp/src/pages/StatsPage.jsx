import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useApp } from "../context/AppContext.jsx";
import { api } from "../lib/api.js";
import { GAMES, TX_TYPE, fmt, fmtDate, fmtSigned, playerName } from "../lib/format.js";

function StatBox({ label, value, tone }) {
  return (
    <div className={`stat-box${tone ? ` ${tone}` : ""}`}>
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function StatsPage() {
  const { user, notify } = useApp();
  const [kind, setKind] = useState("balance");
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .anon(`/api/leaderboard?kind=${kind}&limit=20`)
      .then((data) => {
        if (alive) setRows(data.rows || []);
      })
      .catch(() => notify("Не удалось загрузить топ", "error"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [kind, notify]);

  useEffect(() => {
    if (!user) {
      setStats(null);
      setTxs([]);
      return undefined;
    }
    let alive = true;
    api
      .anon(`/api/user/${user.id}/stats`)
      .then((data) => alive && setStats(data))
      .catch(() => {});
    api
      .me("/api/me/transactions")
      .then((data) => alive && setTxs(data.rows || []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user]);

  const totals = stats?.totals || {};
  const winRate = totals.total ? Math.round((totals.wins / totals.total) * 100) : 0;

  return (
    <div className="stack">
      <section className="card">
        <div className="section-title">
          <h2>🏆 Топ игроков</h2>
          <div className="segmented">
            <button
              type="button"
              className={kind === "balance" ? "is-active" : ""}
              onClick={() => setKind("balance")}
            >
              💰 Баланс
            </button>
            <button
              type="button"
              className={kind === "points" ? "is-active" : ""}
              onClick={() => setKind("points")}
            >
              ⭐ Очки
            </button>
          </div>
        </div>

        {loading ? (
          <span className="spinner" />
        ) : rows.length ? (
          <ol className="top-list">
            {rows.map((row, index) => (
              <li key={row.id} className={row.id === user?.id ? "is-me" : ""}>
                <span className="top-place">{index + 1}</span>
                <span className="top-name">
                  {playerName(row)}
                  <span className="muted small"> · ID {row.id}</span>
                </span>
                <strong>{kind === "points" ? `⭐ ${fmt(row.points)}` : `💳 ${fmt(row.balance)}`}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">Пока никого нет — сыграйте первую игру.</p>
        )}
      </section>

      <section className="card">
        <div className="section-title">
          <h2>📊 Моя статистика</h2>
        </div>

        {!user ? (
          <p className="muted">
            Войдите по коду из Telegram, чтобы видеть свою статистику и баланс.{" "}
            <Link to="/#account">Войти</Link>
          </p>
        ) : !totals.total ? (
          <p className="muted">Вы ещё не сыграли ни одной игры в вебе.</p>
        ) : (
          <>
            <div className="stats-grid">
              <StatBox label="Игр" value={fmt(totals.total)} />
              <StatBox label="Побед" value={fmt(totals.wins)} tone="green" />
              <StatBox label="Поражений" value={fmt(totals.losses)} tone="red" />
              <StatBox label="Винрейт" value={`${winRate}%`} />
              <StatBox label="Выиграно" value={`+${fmt(totals.won)}`} tone="green" />
              <StatBox label="Проиграно" value={`-${fmt(totals.lost)}`} tone="red" />
              <StatBox label="Итог" value={fmtSigned(totals.net)} />
            </div>

            {stats.byGame?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Игра</th>
                      <th>Партий</th>
                      <th>Побед</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byGame.map((item) => (
                      <tr key={item.game_key}>
                        <td>
                          {(GAMES[item.game_key]?.icon || "🎮")} {GAMES[item.game_key]?.title || item.game_key}
                        </td>
                        <td>{item.cnt}</td>
                        <td>{item.wins}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <h3>Последние игры</h3>
            <ul className="plain-list">
              {(stats.recent || []).map((game, index) => (
                <li key={`${game.created_at}-${index}`}>
                  <span>
                    {GAMES[game.game_key]?.icon || "🎮"} {GAMES[game.game_key]?.short || game.game_key}
                    <span className="muted small"> · ставка {fmt(game.bet)}</span>
                  </span>
                  <strong className={game.amount > 0 ? "green" : game.amount < 0 ? "red" : ""}>
                    {fmtSigned(game.amount)}
                  </strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {user && txs.length ? (
        <section className="card">
          <div className="section-title">
            <h2>🧾 Операции</h2>
          </div>
          <ul className="plain-list">
            {txs.map((tx) => (
              <li key={tx.id}>
                <span>
                  {TX_TYPE[tx.type] || tx.type}
                  <span className="muted small"> · {fmtDate(tx.created_at)}</span>
                </span>
                <strong className={tx.amount > 0 ? "green" : "red"}>{fmtSigned(tx.amount)}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
