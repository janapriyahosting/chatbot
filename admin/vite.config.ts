import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Built assets are mounted by FastAPI under /admin/.
export default defineConfig({
  plugins: [react()],
  base: "/admin/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/auth": "http://127.0.0.1:8800",
      "/sites": "http://127.0.0.1:8800",
      "/bots": "http://127.0.0.1:8800",
      "/users": "http://127.0.0.1:8800",
      "/agent": "http://127.0.0.1:8800",
      "/uploads": "http://127.0.0.1:8800",
      "/leads": "http://127.0.0.1:8800",
      "/static": "http://127.0.0.1:8800",
      "/analytics": "http://127.0.0.1:8800",
      "/api-keys": "http://127.0.0.1:8800",
    },
  },
});
