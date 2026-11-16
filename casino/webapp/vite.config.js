import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Сборка кладётся в casino/webapp/dist — её отдаёт Express (casino/server.js).
// В режиме разработки API и Socket.io проксируются на запущенный сервер.
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/socket.io": { target: "http://localhost:3000", ws: true },
    },
  },
});
