import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, getUserToken, setUserToken } from "../lib/api";
import { playerName } from "../lib/format";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [token, setToken] = useState(getUserToken);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(getUserToken()));
  const [toasts, setToasts] = useState([]);

  const notify = useCallback((message, type = "info") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((list) => [...list.slice(-3), { id, message, type }]);
    setTimeout(() => {
      setToasts((list) => list.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    if (!getUserToken()) {
      setUser(null);
      return null;
    }
    try {
      const data = await api.me("/api/auth/me");
      setUser(data.user);
      return data.user;
    } catch (err) {
      if (err.status === 401) {
        setUserToken("");
        setToken("");
      }
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    if (!token) {
      setLoading(false);
      return () => { alive = false; };
    }
    setLoading(true);
    refresh().then((found) => {
      if (!alive) return;
      setLoading(false);
      if (!found) notify("Сессия истекла — получите новый код в боте", "error");
    });
    return () => { alive = false; };
  }, [token, refresh, notify]);

  const loginWithCode = useCallback(async (code) => {
    const data = await api.anon("/api/auth/login", { method: "POST", body: { code } });
    setUserToken(data.token);
    setToken(data.token);
    setUser(data.user);
    notify(`Вы вошли как ${playerName(data.user)} · ID ${data.user.id}`, "success");
    return data.user;
  }, [notify]);

  const logout = useCallback(async () => {
    await api.me("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUserToken("");
    setToken("");
    setUser(null);
    notify("Вы вышли из аккаунта", "info");
  }, [notify]);

  const patchUser = useCallback((patch) => {
    setUser((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const value = useMemo(() => ({
    user,
    token,
    loading,
    loginWithCode,
    logout,
    refresh,
    patchUser,
    notify,
    toasts,
    dismiss,
  }), [user, token, loading, loginWithCode, logout, refresh, patchUser, notify, toasts, dismiss]);

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            className={`toast toast-${toast.type}`}
            onClick={() => dismiss(toast.id)}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp вне AppProvider");
  return value;
}
