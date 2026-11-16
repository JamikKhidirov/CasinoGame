import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import "./styles.css";

const twa = window.Telegram?.WebApp;
if (twa) {
  twa.ready();
  twa.expand();
  twa.setHeaderColor?.("#0f172a");
  twa.setBackgroundColor?.("#0f172a");
}

createRoot(document.getElementById("root")).render(<App />);
