import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBaseUrl =
    String(env.VITE_API_BASE_URL ?? "http://127.0.0.1:5000/api/v1").trim() ||
    "http://127.0.0.1:5000/api/v1";
  const apiOrigin = (() => {
    try {
      return new URL(apiBaseUrl).origin;
    } catch {
      return "http://127.0.0.1:5000";
    }
  })();

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@components": path.resolve(__dirname, "./src/components"),
        "@store": path.resolve(__dirname, "./src/store"),
        "@features": path.resolve(__dirname, "./src/features"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      proxy: {
        "/uploads": {
          target: apiOrigin,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 4173,
      strictPort: true,
      proxy: {
        "/uploads": {
          target: apiOrigin,
          changeOrigin: true,
        },
      },
    },
  };
});
