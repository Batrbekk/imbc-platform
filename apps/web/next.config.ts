import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Web UI — Next.js App Router. Сеансы, OIDC и права живут в NestJS BFF (/api),
 * браузер ходит только на свой origin: в dev — через rewrite ниже, на стенде — через nginx.
 */
const monorepoRoot = new URL("../..", import.meta.url).pathname;

const nextConfig: NextConfig = {
  output: "standalone",
  // Монорепозиторий: трассировка от корня, чтобы standalone забрал workspace-пакеты.
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ["@imbc/contracts"],
  poweredByHeader: false,
  turbopack: {
    root: monorepoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Только для `pnpm dev` на хосте: один origin localhost:3000 для UI, BFF и Keycloak.
  // В Docker и на стендах переменные не заданы — маршрутизирует nginx/ingress.
  async rewrites() {
    const api = process.env.API_PROXY_URL;
    const kc = process.env.KEYCLOAK_PROXY_URL;
    return [
      ...(api ? [{ source: "/api/:path*", destination: `${api}/api/:path*` }] : []),
      ...(kc ? [{ source: "/kc/:path*", destination: `${kc}/kc/:path*` }] : []),
    ];
  },
};

export default withNextIntl(nextConfig);
