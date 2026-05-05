import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SPA is served at the bare root by FastAPI; bundle URLs must be /assets/*.
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8800",
      "/auth": "http://127.0.0.1:8800",
      "/uploads": "http://127.0.0.1:8800",
      "/webhook": "http://127.0.0.1:8800",
      "/static": "http://127.0.0.1:8800",
      "/widget": "http://127.0.0.1:8800",
    },
  },
});
