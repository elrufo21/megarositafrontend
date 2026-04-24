import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { existsSync, readFileSync } from "node:fs";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const httpsCertPath = String(env.VITE_HTTPS_CERT_PATH ?? "").trim();
  const httpsKeyPath = String(env.VITE_HTTPS_KEY_PATH ?? "").trim();
  const httpsPfxPath = String(env.VITE_HTTPS_PFX_PATH ?? "").trim();
  const httpsPfxPassphrase = String(
    env.VITE_HTTPS_PFX_PASSPHRASE ?? "",
  ).trim();

  const resolvedCertPath = httpsCertPath
    ? path.resolve(process.cwd(), httpsCertPath)
    : "";
  const resolvedKeyPath = httpsKeyPath
    ? path.resolve(process.cwd(), httpsKeyPath)
    : "";
  const resolvedPfxPath = httpsPfxPath
    ? path.resolve(process.cwd(), httpsPfxPath)
    : "";

  const httpsConfig =
    resolvedCertPath &&
    resolvedKeyPath &&
    existsSync(resolvedCertPath) &&
    existsSync(resolvedKeyPath)
      ? {
          cert: readFileSync(resolvedCertPath),
          key: readFileSync(resolvedKeyPath),
        }
      : resolvedPfxPath && existsSync(resolvedPfxPath)
      ? {
          pfx: readFileSync(resolvedPfxPath),
          passphrase: httpsPfxPassphrase,
        }
      : undefined;

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
      https: httpsConfig,
    },
    preview: {
      host: "0.0.0.0",
      port: 4173,
      strictPort: true,
      https: httpsConfig,
    },
  };
});
