import { Link, NavLink, Outlet } from "react-router-dom";

import { useApp } from "../context/AppContext.jsx";
import { fmt } from "../lib/format.js";

const TABS = [
  { to: "/", label: "Играть", icon: "🎮", end: true },
  { to: "/stats", label: "Топы", icon: "📊" },
  { to: "/donate", label: "Касса", icon: "💳" },
  { to: "/admin", label: "Админ", icon: "🛠" },
];

export default function Layout() {
  const { user, logout, mode } = useApp();
  const tabs = TABS.filter((tab) => tab.to !== "/donate" || mode !== "fun");

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-icon">🎰</span>
          <span className="brand-text">Casino<b>Game</b></span>
        </Link>

        <div className="topbar-right">
          {mode === "fun" ? (
            <span className="chip chip-mode" title="Пополнения и выводы отключены">
              🎲 Развлечение
            </span>
          ) : null}
          {user ? (
            <>
              <span className="chip chip-balance" title="Баланс">
                💳 {fmt(user.balance)}
              </span>
              <span className="chip chip-id" title="Ваш ID в базе и кошельке">
                🆔 {user.id}
              </span>
              <button type="button" className="btn btn-ghost btn-small" onClick={logout}>
                Выйти
              </button>
            </>
          ) : (
            <Link to="/#account" className="btn btn-ghost btn-small">
              🔐 Войти
            </Link>
          )}
        </div>
      </header>

      <main className="page">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Разделы">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `tab${isActive ? " is-active" : ""}`}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
