# IMBC web (`apps/web`, package `@imbc/web`)

## Stack

- React 19 + TypeScript single-page application built with Vite (specification 11.1). There is no server rendering: sessions, OIDC and rights live in the NestJS BFF (`apps/api`), and the browser talks only to `/api` and `/kc` on its own origin.
- React Router 8 data router; nuqs (React Router v8 adapter) for state in the address; use-intl for translations; TanStack Query for server data; Tailwind CSS 4.
- shadcn/ui on Base UI (`@base-ui/react`), preset `base-nova`. IMBC colours are CSS variables in `src/index.css` on top of the preset.
- Vitest + jsdom + Testing Library. Run `pnpm --filter @imbc/web test`; `pnpm --filter @imbc/web dev` serves on `:3000`.
- In Docker the static `dist/` is served by nginx (`infrastructure/docker/web.Dockerfile`, `infrastructure/nginx/web.conf`) as `web:3000`, without root.

## Routes

- All routes are in `src/router.tsx`. Keep the existing addresses: `/`, `/login`, `/register`, `/auth/verify`, `/auth/responsibility`, `/catalog`, `/dashboard`, `/account`, `/profile`. BFF redirects point at them.
- Application pages and the `AppShell` layout are `lazy` routes (one chunk each); the root route has `ErrorBoundary` (`src/routes/route-error.tsx`, one guarded reload on a failed chunk) and `HydrateFallback`. `"*"` stays last.
- Each page renders one `PageTitle` (`src/components/app/page-title.tsx`). It sets `document.title`, which updates the single `<title>` of `index.html`; do not render `<title>` elements, React 19 would hoist a second one into `<head>`.
- Links to `/api/*` and `/kc/*` are plain `<a href>` or `leaveApp()` from `src/lib/leave-app.ts` — never React Router `Link` or `navigate`: the BFF and Keycloak serve them, not the SPA.

## Base UI rules (differences from Radix)

1. `asChild` becomes `render`: `<PopoverTrigger render={<Button variant="outline" />}>…</PopoverTrigger>`; the same for `DropdownMenuTrigger`, `TooltipTrigger`, `SheetTrigger`, `DialogClose`, `SidebarMenuButton`, `Badge`.
2. A link styled as a button stays a link: `<a className={buttonVariants({ variant, size })} href={url}>` or `<Link className={buttonVariants({ variant, size })} to="/…">`. Do not use `Button render={<a />}` for links: Base UI gives it `role="button"` and button keyboard behaviour. In tests find such elements with `getByRole("link")`. `Button render` is for real buttons and triggers.
3. `Select` needs `items` (an array of `{ value, label }`) on the root, otherwise `SelectValue` shows the raw value; the placeholder is an item with `value: null`; position with `alignItemWithTrigger`; `onValueChange(value, eventDetails)` may pass `null`.
4. `Checkbox.onCheckedChange(checked: boolean, eventDetails)`; `DropdownMenuRadioGroup.onValueChange(value, eventDetails)` gives `unknown` — check it before use.
5. `TooltipProvider` is not built into `Tooltip` or `Sidebar`: the app is wrapped in it once (`src/components/app/providers.tsx`).

## Components

- Add shadcn/ui components only with the CLI, from this directory: `pnpm dlx shadcn@4.23.0 add <name>` — the CLI version pinned in `package.json`; the style `base-nova` comes from `components.json`, or inspect them first with the shadcn MCP tools (`.mcp.json` points here). Do not write them from memory.
- Preserve local edits when a component is re-added. `src/components/ui/sidebar.tsx` has one, marked with a comment: the mobile Sheet title and description are props (`mobileTitle`, `mobileDescription`) so that they can be translated. Re-adding `sidebar` with `--overwrite` removes it; restore it afterwards.

## Translations and language

- Texts live in `messages/{en,kk,ru}.json`. English is the source file; the three files have the same keys (a test checks this). Every new text is added in all three languages at once.
- Dates and numbers go through `useFormat` from `src/i18n/format.ts` (`date`, `dateTime`, `number`), never `useFormatter`, `Intl` or `toLocale*String` directly (ESLint enforces it). Chrome has no ICU data for `kk` and silently falls back to the root pattern (`2026 M10 15`, `1,234,567.5`), so Kazakh is formatted there without locale data: `dd.MM.yyyy`, `dd.MM.yyyy, HH:mm`, a no-break space between digit groups and a comma before decimals. Russian and English go through use-intl. The time zone is `TIME_ZONE` (`Asia/Almaty`), also set on `IntlProvider` (`src/i18n/provider.tsx`).
- Messages do not format numbers or dates themselves: no `#`, `{x, number}`, `{x, date}` or `{x, time}` (a test checks this). Pass the plural count and a ready string, e.g. `t("found", { count, total: format.number(count) })` with `{count, plural, other {{total} …}}`.
- The language is the cookie `NEXT_LOCALE` (no locale prefix in the address). Do not rename it: the IMBC Keycloak theme (`infrastructure/keycloak/identity`) writes the same cookie. An unknown value or no cookie means Kazakh (`DEFAULT_LOCALE` from `@imbc/contracts`).

## Catalog filters

- Catalog filters in the address are defined in `src/lib/catalog-params.ts` in the format of `catalogFilterSchema` from `@imbc/contracts` (comma-separated lists, `true`/`false`). The page query string goes unchanged to `GET /api/v1/catalog/search`, so a copied link reproduces the search.

## Content-Security-Policy

- The image sends `script-src 'self'` (see `infrastructure/nginx/web.conf`). Do not add inline scripts or inline event handlers to `index.html` or anywhere else; `test/index-html.test.ts` checks the template. Fonts, images and scripts are bundled from this origin; there are no third-party hosts.
- The `web` container sets only `Content-Security-Policy` and `Cache-Control` (`infrastructure/nginx/web.conf`). The other security headers come from the edge proxies: `X-Content-Type-Options: nosniff`, `Referrer-Policy` and `X-Frame-Options` from both the local nginx (`infrastructure/nginx/nginx.conf`) and Caddy on the Azure stand (`infrastructure/azure/Caddyfile`); `Strict-Transport-Security` (HSTS) and `Permissions-Policy` only from Caddy on the Azure stand. Do not repeat them in `web.conf`.

## Local development

- `cp .env.example .env.local`, then `pnpm dev`: Vite proxies `/api` to `API_PROXY_URL` and `/kc` to `KEYCLOAK_PROXY_URL` (`dev-proxy.ts`), so the browser keeps one origin, `http://localhost:3000`.
