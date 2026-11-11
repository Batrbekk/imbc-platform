import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist", "coverage"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Даты и числа — только через useFormat (src/i18n/format.ts): для kk в Chrome Intl отдаёт
    // корневой шаблон, поэтому казахский форматируется там без данных локали (LANG-04).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/i18n/format.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "use-intl",
              importNames: ["useFormatter", "createFormatter"],
              message: "Форматируйте даты и числа через useFormat из @/i18n/format.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Intl", message: "Форматируйте даты и числа через useFormat из @/i18n/format." },
        { property: "toLocaleString", message: "Форматируйте даты и числа через useFormat из @/i18n/format." },
        { property: "toLocaleDateString", message: "Форматируйте даты через useFormat из @/i18n/format." },
        { property: "toLocaleTimeString", message: "Форматируйте время через useFormat из @/i18n/format." },
      ],
    },
  },
  {
    // shadcn экспортирует варианты (cva) рядом с компонентами.
    files: ["src/components/ui/**"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
]);
