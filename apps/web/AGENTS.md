# IMBC web (`apps/web`, package `@imbc/web`)

## Stack

- React 19 + TypeScript single-page application built with Vite (specification 11.1). There is no server rendering: sessions, OIDC and rights live in the NestJS BFF (`apps/api`), and the browser talks only to `/api` and `/kc` on its own origin.
- The BFF client `src/lib/api.ts` sends every request with `cache: "no-store"`, and the API answers every request with `Cache-Control: no-store`, so the browser never draws application data from its HTTP cache, also after sign-out and Back (NFR-11).
- React Router 8 data router; nuqs (React Router v8 adapter) for state in the address; use-intl for translations; TanStack Query for server data; Tailwind CSS 4.
- shadcn/ui on Base UI (`@base-ui/react`), preset `base-nova`. IMBC colours are CSS variables in `src/index.css` on top of the preset.
- Vitest + jsdom + Testing Library. Run `pnpm --filter @imbc/web test`; `pnpm --filter @imbc/web dev` serves on `:3000`.
- In Docker the static `dist/` is served by nginx (`infrastructure/docker/web.Dockerfile`, `infrastructure/nginx/web.conf`) as `web:3000`, without root.

## Routes

- All routes are in `src/router.tsx`. Keep the existing addresses: `/`, `/login`, `/register`, `/auth/verify`, `/auth/responsibility`, `/catalog`, `/companies/:profileId`, `/dashboard`, `/reviews`, `/admin/accounts`, `/account`, `/profile`. BFF redirects point at them.
- Application pages and the `AppShell` layout are `lazy` routes (one chunk each); the root route has `ErrorBoundary` (`src/routes/route-error.tsx`, one guarded reload on a failed chunk) and `HydrateFallback`. `"*"` stays last.
- Each page renders one `PageTitle` (`src/components/app/page-title.tsx`). It sets `document.title` in a layout effect, which updates the single `<title>` of `index.html`, and resets it to the platform name on unmount; do not render `<title>` elements, React 19 would hoist a second one into `<head>`.
- The root route (`src/routes/root.tsx`) has a visually hidden `aria-live="polite"` region (`RouteAnnouncer`) that reads the new `document.title` to screen readers after the path changes; it is silent on the first render and on query-string changes. Give every page a meaningful `PageTitle`: that is what gets announced.
- A tab restored from the back/forward cache reloads (`src/lib/bfcache.ts`, registered in `src/main.tsx`), so the session is checked again after sign-out and Back (NFR-11).
- Links to `/api/*` and `/kc/*` are plain `<a href>` or `leaveApp()` from `src/lib/leave-app.ts` — never React Router `Link` or `navigate`: the BFF and Keycloak serve them, not the SPA.

## Base UI rules (differences from Radix)

1. `asChild` becomes `render`: `<PopoverTrigger render={<Button variant="outline" />}>…</PopoverTrigger>`; the same for `DropdownMenuTrigger`, `TooltipTrigger`, `SheetTrigger`, `DialogClose`, `SidebarMenuButton`, `Badge`.
2. A link styled as a button stays a link: `<a className={buttonVariants({ variant, size })} href={url}>` or `<Link className={buttonVariants({ variant, size })} to="/…">`. Do not use `Button render={<a />}` for links: Base UI gives it `role="button"` and button keyboard behaviour. In tests find such elements with `getByRole("link")`. `Button render` is for real buttons and triggers.
3. `Select` needs `items` (an array of `{ value, label }`) on the root, otherwise `SelectValue` shows the raw value; the placeholder is an item with `value: null`; position with `alignItemWithTrigger`; `onValueChange(value, eventDetails)` may pass `null`.
4. `Checkbox.onCheckedChange(checked: boolean, eventDetails)`; `DropdownMenuRadioGroup.onValueChange(value, eventDetails)` gives `unknown` — check it before use.
5. `TooltipProvider` is not built into `Tooltip` or `Sidebar`: the app is wrapped in it once (`src/components/app/providers.tsx`).

## Components

- Add shadcn/ui components only with the CLI, from this directory: `pnpm dlx shadcn@4.23.0 add <name>`. That is the version locked in `pnpm-lock.yaml` (`package.json` has the range `^4.23.0`); the style `base-nova` comes from `components.json`. Do not write components from memory.
- You can inspect components first with the shadcn MCP tools (`.mcp.json` points here). The MCP server is started with `shadcn@latest` because it only reads the registry; files are added with the pinned CLI so that generated code stays reproducible.
- Preserve local edits when a component is re-added. `src/components/ui/sidebar.tsx` has one, marked with a comment: the mobile Sheet title and description are props (`mobileTitle`, `mobileDescription`) so that they can be translated. Re-adding `sidebar` with `--overwrite` removes it; restore it afterwards.

## Translations and language

- Texts live in `messages/{en,kk,ru}.json`. English is the source file; the three files have the same keys (a test checks this). Every new text is added in all three languages at once.
- Dates and numbers go through `useFormat` from `src/i18n/format.ts` (`date`, `dateTime`, `number`), never `useFormatter`, `Intl` or `toLocale*String` directly (ESLint enforces it). Chrome has no ICU data for `kk` and silently falls back to the root pattern (`2026 M10 15`, `1,234,567.5`), so Kazakh is formatted there without locale data: `dd.MM.yyyy`, `dd.MM.yyyy, HH:mm`, a no-break space between digit groups and a comma before decimals. Russian and English go through use-intl. The time zone is `TIME_ZONE` (`Asia/Almaty`), also set on `IntlProvider` (`src/i18n/provider.tsx`).
- Messages do not format numbers or dates themselves: no `#`, `{x, number}`, `{x, date}` or `{x, time}` (a test checks this). Pass the plural count and a ready string, e.g. `t("found", { count, total: format.number(count) })` with `{count, plural, other {{total} …}}`. A simple numeric argument also goes through the formatter: `t("page", { page: format.number(page), pages: format.number(pages) })`, `t("resendIn", { seconds: format.number(seconds) })` — a raw number would skip digit grouping.
- Invalid or missing dates are formatted as `—` in every language; do not guard `format.date` / `format.dateTime` calls yourself.
- The ESLint rule in `eslint.config.js` forbids `useFormatter` / `createFormatter` from `use-intl`, `use-intl/react` and `use-intl/core`, any value use of `Intl` (`Intl.*`, `globalThis.Intl`, `window.Intl`) and `toLocale*String` outside `src/i18n/format.ts`. Type references such as `Intl.DateTimeFormatOptions` are allowed.
- The language is the cookie `NEXT_LOCALE` (no locale prefix in the address). Do not rename it: the IMBC Keycloak theme (`infrastructure/keycloak/identity`) writes the same cookie. An unknown value or no cookie means Kazakh (`DEFAULT_LOCALE` from `@imbc/contracts`).

## Catalog filters

- Catalog filters in the address are defined in `src/lib/catalog-params.ts` in the format of `catalogFilterSchema` from `@imbc/contracts` (comma-separated lists, `true`/`false`). The request to `GET /api/v1/catalog/search` is rebuilt from these parsers: every key the interface knows is passed in the format `catalogFilterSchema` parses, so a copied link reproduces the search; any other key in the address is dropped. `test/catalog.test.tsx` lists the schema keys that have no control yet (`KEYS_WITHOUT_CONTROL`); when you add a control, move its key into `catalogParsers` and the test samples.

## Content-Security-Policy

- The image sends `script-src 'self'` (see `infrastructure/nginx/web.conf`). Do not add inline scripts or inline event handlers to `index.html` or anywhere else; `test/index-html.test.ts` checks the template. Fonts, images and scripts are bundled from this origin; there are no third-party hosts.
- `Cache-Control` from `web.conf`: every address that falls back to `index.html` is `no-store`, so the browser keeps no copy of a page after sign-out (NFR-11); hashed files under `/assets/` are `public, max-age=31536000, immutable`; a missing file under `/assets/` is 404, not `index.html`. `test/web-conf.test.ts` pins these rules.
- Do not mount the `ThemeProvider` of the bundled `next-themes` package (the generated `sonner.tsx` only calls its `useTheme`): its inline script would be blocked by this Content-Security-Policy.
- The `web` container sets only `Content-Security-Policy` and `Cache-Control` (`infrastructure/nginx/web.conf`). The other security headers come from the edge proxies: `X-Content-Type-Options: nosniff`, `Referrer-Policy` and `X-Frame-Options` from both the local nginx (`infrastructure/nginx/nginx.conf`) and Caddy on the Azure stand (`infrastructure/azure/Caddyfile`); `Strict-Transport-Security` (HSTS) and `Permissions-Policy` only from Caddy on the Azure stand. Do not repeat them in `web.conf`.

## Browser storage

- `sessionStorage` holds only: the reload flags `imbc:startup-reload` and `imbc:lazy-reload` and the trial key `imbc:storage-probe` (`src/lib/reload-guard.ts`), and the scroll positions of React Router's `ScrollRestoration` (`react-router-scroll-positions`). The application stores nothing else there and nothing in `localStorage`: data of a signed-in user must not outlive the session in the browser. The language is the `NEXT_LOCALE` cookie. The one exception is the role-cabinet prototype below: its fictional demo state lives in `localStorage["imbc-prototype-v1"]`, only in a build with the prototype flag.

## Role-cabinet prototype (`src/prototype`)

- A demo layer, not product code: each role's cabinet under `/proto/<role>/<screen>` with fictional data in the browser; no `/api/v1` calls, only the session (`useMe`). It is built only with `VITE_PROTOTYPE_CABINETS=true` (on for the Azure dev stand in `compose.azure.yaml`, `PROTOTYPE_CABINETS` for the local stand); without it `dist` has no prototype code, menu group or route.
- Code outside `src/prototype` reaches it only through `import()` behind the literal `import.meta.env.VITE_PROTOTYPE_CABINETS === "true"` at the call site (`router.tsx`, `app-shell.tsx`); a static import or the `PROTOTYPE` constant there would ship the chunks (`test/prototype-off.test.tsx`).
- The contract for role modules — registry, store, data, shared components, dictionary and test helper — is `src/prototype/README.md`. A role module changes only `src/prototype/<role>/**` and `test/prototype/<role>/**`. Tests under `test/prototype/**` run in the vitest project `prototype` with the flag on; the rest run without it.

## Local development

- `cp .env.example .env.local`, then `pnpm dev`: Vite proxies `/api` to `API_PROXY_URL` and `/kc` to `KEYCLOAK_PROXY_URL` (`dev-proxy.ts`), so the browser keeps one origin, `http://localhost:3000`.
