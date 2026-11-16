import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout.jsx";
import { AppProvider } from "./context/AppContext.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import DonatePage from "./pages/DonatePage.jsx";
import GamePage from "./pages/GamePage.jsx";
import HomePage from "./pages/HomePage.jsx";
import StatsPage from "./pages/StatsPage.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="game" element={<GamePage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="donate" element={<DonatePage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}
