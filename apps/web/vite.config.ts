import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { configDefaults } from "vitest/config";

import { devProxy } from "./dev-proxy.ts";

// Каталог пакета, а не process.cwd(): при запуске с --config из корня репозитория
// переменные прокси всё равно читаются из apps/web/.env.local.
const packageDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: devProxy(loadEnv(mode, packageDir, "")),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
    // Тесты прототипа кабинетов ролей идут с флагом сборки (test/prototype), остальные — без него,
    // как в сборке по умолчанию: готовые экраны проверяются без группы «Прототип».
    projects: [
      {
        extends: true,
        test: {
          name: "web",
          include: ["test/**/*.test.{ts,tsx}"],
          exclude: [...configDefaults.exclude, "test/prototype/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "prototype",
          include: ["test/prototype/**/*.test.{ts,tsx}"],
          env: { VITE_PROTOTYPE_CABINETS: "true" },
        },
      },
    ],
  },
}));
