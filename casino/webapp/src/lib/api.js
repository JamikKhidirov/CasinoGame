const USER_TOKEN_KEY = "casino_session_token";
const ADMIN_TOKEN_KEY = "casino_admin_token";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getUserToken() {
  try { return localStorage.getItem(USER_TOKEN_KEY) || ""; } catch { return ""; }
}

export function setUserToken(token) {
  try {
    if (token) localStorage.setItem(USER_TOKEN_KEY, token);
    else localStorage.removeItem(USER_TOKEN_KEY);
  } catch { /* приватный режим */ }
}

export function getAdminToken() {
  try { return sessionStorage.getItem(ADMIN_TOKEN_KEY) || ""; } catch { return ""; }
}

export function setAdminToken(token) {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch { /* приватный режим */ }
}

async function request(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Нет соединения с сервером", 0);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    throw new ApiError(data?.error || `Ошибка ${res.status}`, res.status);
  }
  return data;
}

export const api = {
  anon: (path, opts = {}) => request(path, opts),
  me: (path, opts = {}) => request(path, { ...opts, token: getUserToken() }),
  admin: (path, opts = {}) => request(path, { ...opts, token: getAdminToken() }),
};
