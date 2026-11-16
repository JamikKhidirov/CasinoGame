export const GAMES = {
  blackjack: { icon: "🃏", title: "Блэкджек 21", short: "Блэкджек" },
  durak: { icon: "♠️", title: "Дурак", short: "Дурак" },
  dice: { icon: "🎲", title: "Кости", short: "Кости" },
};

export const OUTCOME = {
  win: "Победа",
  lose: "Проигрыш",
  tie: "Ничья",
  bot: "Бот",
};

export const STATUS = {
  waiting: "Ожидание",
  playing: "Игра идёт",
  finished: "Завершена",
};

export const DEPOSIT_STATUS = {
  pending: "На проверке",
  approved: "Зачислено",
  rejected: "Отклонено",
};

export const TX_TYPE = {
  bet: "Ставка",
  win: "Выигрыш",
  deposit: "Пополнение",
  withdraw: "Вывод",
  refund: "Возврат",
  admin: "Админ",
  transfer: "Перевод",
  promo: "Промокод",
  daily: "Бонус",
};

export function fmt(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0";
  return Math.round(number).toLocaleString("ru-RU");
}

export function fmtSigned(value) {
  const number = Number(value ?? 0);
  return `${number > 0 ? "+" : ""}${fmt(number)}`;
}

export function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function playerName(user) {
  if (!user) return "Игрок";
  return user.first_name || user.username || `Игрок_${user.id}`;
}

/** Гостевой ID для игры без Telegram: отрицательный, чтобы не пересечься с Telegram ID. */
export function guestIdentity() {
  let id = "";
  try { id = localStorage.getItem("casino_player_id") || ""; } catch { /* ignore */ }
  if (!/^-?\d+$/.test(id) || Number(id) > 0) {
    id = String(-Math.floor(100000000 + Math.random() * 899999999));
    try { localStorage.setItem("casino_player_id", id); } catch { /* ignore */ }
  }
  let name = "";
  try { name = localStorage.getItem("casino_player_name") || ""; } catch { /* ignore */ }
  if (!name) {
    name = `Игрок_${Math.floor(Math.random() * 1000)}`;
    try { localStorage.setItem("casino_player_name", name); } catch { /* ignore */ }
  }
  return { id, name };
}

export function saveGuestName(name) {
  try { localStorage.setItem("casino_player_name", name); } catch { /* ignore */ }
}
