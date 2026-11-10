import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { keycloakify } from "keycloakify/vite-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), keycloakify({ themeName: "imbc", accountThemeImplementation: "none", keycloakVersionTargets: { "22-to-25": false, "all-other-versions": "imbc-theme.jar" }, extraThemeProperties: ["darkMode=false"] })],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
