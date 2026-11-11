import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const FORMAT_MESSAGE = "Форматируйте даты и числа через useFormat из @/i18n/format.";

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
          // use-intl/react и use-intl/core экспортируют те же форматтеры, что и корень пакета.
          paths: ["use-intl", "use-intl/react", "use-intl/core"].map((name) => ({
            name,
            importNames: ["useFormatter", "createFormatter"],
            message: FORMAT_MESSAGE,
          })),
        },
      ],
      "no-restricted-properties": [
        "error",
        { property: "toLocaleString", message: FORMAT_MESSAGE },
        { property: "toLocaleDateString", message: FORMAT_MESSAGE },
        { property: "toLocaleTimeString", message: FORMAT_MESSAGE },
      ],
      "no-restricted-syntax": [
        "error",
        {
          // Intl как значение: Intl.NumberFormat, globalThis.Intl, window.Intl, const { Intl } = self.
          // Типы (Intl.DateTimeFormatOptions, typeof Intl) ничего не форматируют и разрешены.
          selector: "Identifier[name='Intl']:not(TSQualifiedName > Identifier, TSTypeQuery > Identifier)",
          message: FORMAT_MESSAGE,
        },
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
