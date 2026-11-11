# Web UI на Vite SPA и shadcn/ui Base UI (base-nova) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** перевести `apps/web` с Next.js на одностраничное приложение React + TypeScript на Vite (спецификация 11.1), а shadcn/ui — на Base UI с пресетом `base-nova`, сохранив все адреса, переходы по состоянию сеанса, формат фильтров каталога в адресе, языки и обращения только к своему origin.

**Architecture:** новое приложение собирается рядом со старым в `apps/web-spa` (пакет `@imbc/web-spa`, dev-порт 3010) и переносит страницы по частям; Next.js-приложение до переключения продолжает собираться и работать. Задача 5 одним коммитом удаляет Next.js, переносит `apps/web-spa` в `apps/web` и меняет Docker-образ: контейнер `web` остаётся на `web:3000`, но отдаёт статическую сборку через nginx, поэтому `nginx.conf` и `Caddyfile` не меняются. Сеансы, OIDC и права остаются в NestJS BFF; браузер ходит только на `/api` и `/kc` своего origin.

**Tech Stack:** Vite 8, React 19.3, TypeScript 5.9, React Router 8 (data router), nuqs 2.10 (адаптер `react-router/v8`), use-intl 4.14, TanStack Query 5, Tailwind CSS 4 (`@tailwindcss/vite`), shadcn CLI 4.23 (`base-nova`, `@base-ui/react` 1.9), Vitest 5 + jsdom + Testing Library, ESLint 9 (flat), nginx (`nginxinc/nginx-unprivileged:1.29-alpine`).

**Spec:** `docs/analyst/2026-11-11/specification-v1.3.md` — 11.1 (Frontend), LANG-01…05, NFR-13…15, OPR-05, OPR-31; `docs/analyst/2026-11-11/v0.5-architecture-update-brief.md` §14 (карта областей по ролям). Решения владельца от 11.11.2026: Vite SPA; shadcn/ui на Base UI с пресетом `base-nova`; цвета IMBC — CSS-переменными поверх пресета; логотип IMBC — PNG 736×212 с альфа-каналом.

## Выбранные решения

| Вопрос | Решение | Почему |
|---|---|---|
| Роутер | **React Router 8**, data router: `createBrowserRouter` + `RouterProvider`, вложенные layout-маршруты | У nuqs 2.10 есть адаптер `nuqs/adapters/react-router/v8`; layout-маршруты повторяют группы `(auth)` и `(app)` Next; `createMemoryRouter` с теми же `routes` даёт тесты маршрутов без браузера |
| i18n | **use-intl** — ядро next-intl без Next | Тот же API (`useTranslations`, `useFormatter`, `useLocale`, `IntlProvider`) и тот же ICU-формат файлов `messages/*.json`: страницы переносятся заменой импорта |
| Фильтры в адресе | **nuqs** с адаптером React Router 8; `src/lib/catalog-params.ts` переносится без изменений | Парсеры и `createSerializer` не зависят от фреймворка, поэтому query string страницы по-прежнему без преобразований уходит в `GET /api/v1/catalog/search` и разбирается `catalogFilterSchema` (OPR-05) |
| Тесты web | **Vitest 5** (как в `apps/api` и `packages/contracts`) с jsdom и Testing Library | Те же алиасы `@/`, что у Vite; компонентные тесты маршрутов; `node:test` с `--experimental-strip-types` не понимает TSX и алиасы |
| Раздача в Docker | Многостадийный образ: сборка на Node 26 → `nginxinc/nginx-unprivileged:1.29-alpine`, слушает **3000**, SPA-fallback на `index.html` | Адрес `web:3000` прежний — `infrastructure/nginx/nginx.conf` и `infrastructure/azure/Caddyfile` не меняются; процесс без root, как прежний `USER node` |
| Dev-прокси вместо rewrites | `server.proxy` Vite из `API_PROXY_URL` и `KEYCLOAK_PROXY_URL` (`apps/web/.env.local`), ключи `^/api(?:/|$)` и `^/kc(?:/|$)`, `changeOrigin: false`, `xfwd: true` | Повторяет rewrites Next (`/api/:path*`, `/kc/:path*`) и поведение nginx (`Host` браузера, `X-Forwarded-*`) |
| Заголовки безопасности | Next своих security-заголовков не ставил (только отключённый `X-Powered-By` и `Cache-Control`). Edge (nginx локально, Caddy в Azure) по-прежнему ставит `nosniff`, `Referrer-Policy`, `X-Frame-Options`, HSTS. Контейнер `web` добавляет только то, чего у edge нет: `Content-Security-Policy` и `Cache-Control` | Без дублирования заголовков edge; SPA без inline-скриптов позволяет строгую CSP (ASVS, NFR-11) |

## Global Constraints

- Работа идёт в `git worktree` на ветке `feat/web-vite-spa` от `feat/spec-v1.3-contracts`. В worktree есть только закоммиченные файлы; нет `node_modules`. Коммиты локальные, по одному на задачу. Без `git push` и без деплоя.
- После каждой задачи: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — зелёные. Задача, которая меняет зависимости, запускает `pnpm install` и коммитит `pnpm-lock.yaml`.
- `packages/contracts` и `apps/api` не меняются (их параллельно меняет этап 0). Редиректы API (`/login?error=…`, `/login?logged_out=1`, `/auth/verify?returnTo=…`) указывают на адреса, которые сохраняются, — правка API не нужна.
- `docs/development-roadmap.md`, `.github/workflows/deploy-*.yml` и `infrastructure/azure/deploy.sh` не редактируются. `infrastructure/nginx/nginx.conf`, `infrastructure/azure/Caddyfile`, `compose.yaml`, `compose.azure.yaml`, `Makefile`, `.github/workflows/ci.yml` — тоже: план устроен так, что правка не нужна. Если она всё же понадобится, это решает владелец.
- Адреса и поведение сохраняются: `/`, `/login`, `/register`, `/auth/verify`, `/auth/responsibility`, `/catalog`, `/dashboard`, `/account`, `/profile`; переходы по состоянию сеанса (401 → вход с `returnTo`, нет второго фактора → `/auth/verify`, нет ответственности → `/auth/responsibility`, чужая страница → стартовая страница роли через `authDestination`).
- Ссылки на `/api/*` и `/kc/*` — только обычные `<a href>` или `leaveApp()`, никогда `Link`/`navigate` React Router: их обслуживает BFF или Keycloak, а не SPA.
- Язык — cookie **`NEXT_LOCALE`** без префикса в адресе (LANG-01): имя не меняется, его пишет и тема Keycloak (`infrastructure/keycloak/identity/src/login/KcPage.tsx`). Формат записи: `NEXT_LOCALE=<locale>; Path=/; Max-Age=31536000; SameSite=Lax`, на HTTPS — `; Secure`. Неизвестное значение или его отсутствие → `kk` (`DEFAULT_LOCALE` из `@imbc/contracts`).
- Переводы: три файла `messages/{en,kk,ru}.json` с одинаковыми наборами ключей; английский — исходный (LANG-02). Каждый новый текст — сразу на трёх языках. Даты и числа — через `useFormatter` с `timeZone: "Asia/Almaty"` (LANG-04, DATA-08).
- Компоненты shadcn добавляются только CLI (`pnpm dlx shadcn@4.23.0 …`) в варианте `base-nova`, не пишутся по памяти. Пока `.mcp.json` указывает на `apps/web` со стилем `new-york`, MCP-инструменты shadcn показывают Radix-варианты; до задачи 5 состав и код компонентов смотреть командой `pnpm dlx shadcn@4.23.0 view @shadcn/<имя> -c apps/web-spa` или `add <имя> --dry-run -c apps/web-spa`. После добавления — контрольный список `get_audit_checklist` MCP shadcn (импорты, зависимости, lint, типы).
- Отличия Base UI от Radix, которые затрагивают наш код (по `rules/base-vs-radix.md` shadcn):
  1. `asChild` → `render`: `<PopoverTrigger render={<Button variant="outline" />}>…</PopoverTrigger>`; то же для `DropdownMenuTrigger`, `TooltipTrigger`, `SheetTrigger`, `DialogClose`, `SidebarMenuButton`, `Badge`.
  2. **Ссылка с видом кнопки остаётся ссылкой** (решение контроллера 11.11 по итогам задачи 1): `<a className={buttonVariants({ variant, size })} href={url}>…</a>` или `<Link className={buttonVariants({ variant, size })} to="/…">…</Link>`. `Button render={<a />}` для ссылок не используется: в `@base-ui/react` 1.9 `Button` ставит такому элементу `role="button"` и кнопочное поведение клавиатуры, а документация Base UI прямо не советует рендерить ссылки через `Button`. В тестах такие элементы ищутся как `getByRole('link')`. `Button render` остаётся для настоящих кнопок и триггеров.
  3. `Select`: у корня обязателен `items` (массив `{ value, label }`), иначе `SelectValue` показывает сырое значение; плейсхолдер — элемент с `value: null`; позиционирование — `alignItemWithTrigger` (вместо Radix `position`); `onValueChange(value, eventDetails)` может передать `null`.
  4. `Checkbox.onCheckedChange(checked: boolean, eventDetails)`; `DropdownMenuRadioGroup.onValueChange(value, eventDetails)` — значение `unknown`, его надо проверить.
  5. `TooltipProvider` не встроен ни в `Tooltip`, ни в `Sidebar`: приложение оборачивается в него один раз.
- Внешний вид меняется только там, где этого требует пресет `base-nova` (высота контролов, радиусы) и логотип; цвета — переменные IMBC из текущего `apps/web/src/app/globals.css` (NFR-15).
- Не делаем: тему Keycloak (отдельный план), фильтр и плитки тиров, стартовые страницы по ролям (OPR-31), любые новые функции. Если этап 0 к моменту задачи 5 добавил что-то в `apps/web`, это переносится как есть (шаг 1 задачи 5).

## Review Focus

1. Ссылка каталога с закодированной запятой (`?region=KZ-ATY%2CKZ-MAN`, так её отдают почтовые клиенты и мессенджеры) открывает тот же поиск, что и `?region=KZ-ATY,KZ-MAN`, и уходит в API в одинаковом виде. Тест — задача 4.
2. Вкладка, открытая до выката новой версии: переключение языка запрашивает старый хешированный файл переводов и получает 404. Ожидается: язык всё равно меняется (cookie записан, страница перезагружается), а отсутствующий `/assets/*` отвечает 404, а не `index.html`. Тесты — задачи 2 и 5.
3. Cookie `NEXT_LOCALE`, записанный темой Keycloak (с `Secure`, рядом с другими cookie) или испорченный (`NEXT_LOCALE=de`), — интерфейс открывается на этом языке или на казахском, без ошибки. Тест — задача 2.
4. Согласие с условиями при регистрации ставится кликом по тексту подписи и с клавиатуры, как с Radix; Base UI рендерит чекбокс иначе, и связь `<label for>` может потеряться. Тест — задача 3.
5. Фильтры «Обследование» и «Единый реестр» в каталоге показывают подпись («Иә», «Да», «Yes»), а не значение `true` из адреса: в Base UI `SelectValue` без `items` выводит сырое значение. Тест — задача 4.

---

### Task 1: каркас Vite-приложения `apps/web-spa` и компоненты shadcn base-nova

**Files:**
- Create: `apps/web-spa/package.json`, `apps/web-spa/index.html`, `apps/web-spa/vite.config.ts`, `apps/web-spa/dev-proxy.ts`, `apps/web-spa/tsconfig.json`, `apps/web-spa/eslint.config.js`, `apps/web-spa/.gitignore`, `apps/web-spa/.env.example`, `apps/web-spa/src/main.tsx` (временная заглушка), `apps/web-spa/src/vite-env.d.ts`, `apps/web-spa/src/index.css`
- Create (CLI): `apps/web-spa/components.json`, `apps/web-spa/src/lib/utils.ts`, `apps/web-spa/src/components/ui/*.tsx`, `apps/web-spa/src/hooks/use-mobile.ts`
- Modify: `pnpm-lock.yaml`
- Test: `apps/web-spa/test/setup.ts`, `apps/web-spa/test/dev-proxy.test.ts`, `apps/web-spa/test/ui-kit.test.tsx`

**Interfaces:**
- Produces: `devProxy(env: Record<string, string | undefined>): Record<string, ProxyOptions>` в `apps/web-spa/dev-proxy.ts` (`ProxyOptions` из `vite`).
- Produces: компоненты `@/components/ui/{alert,badge,button,card,checkbox,command,dialog,dropdown-menu,empty,field,input,input-group,input-otp,label,popover,select,separator,sheet,sidebar,skeleton,sonner,spinner,table,textarea,tooltip}` в варианте `base-nova`; `cn` из `@/lib/utils`; `useIsMobile()` из `@/hooks/use-mobile`.
- Produces: скрипты пакета `dev` (`vite --port 3010 --strictPort`), `build` (`vite build`), `preview` (`vite preview --port 3010 --strictPort`), `lint` (`eslint .`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`).

- [ ] **Step 1: Зависимости рабочей копии**

Run: `pnpm install --frozen-lockfile`
Expected: установка без ошибок; `pnpm build` — PASS на исходном состоянии ветки.

- [ ] **Step 2: Пакет, Vite, TypeScript, Tailwind**

`package.json`: `"name": "@imbc/web-spa"`, `"private": true`, `"type": "module"`, скрипты из Interfaces. Зависимости: `react` и `react-dom` `19.3.0`, `@fontsource-variable/inter` `^5.3.0`. Dev: `vite ^8.3.8`, `@vitejs/plugin-react ^6.3.0`, `tailwindcss ^4.3.5`, `@tailwindcss/vite ^4.3.5`, `typescript 5.9.3`, `@types/react ^19`, `@types/react-dom ^19`, `@types/node ^24`, `eslint ^9.39`, `@eslint/js ^9`, `typescript-eslint ^8.72`, `eslint-plugin-react-hooks ^7.1`, `eslint-plugin-react-refresh ^0.5`, `globals`, `vitest ^5.1.0`, `jsdom`, `@testing-library/react ^16.3`, `@testing-library/dom`, `@testing-library/user-event`.

`tsconfig.json`: `target ES2022`, `lib ["DOM","DOM.Iterable","ES2023"]`, `module ESNext`, `moduleResolution bundler`, `jsx react-jsx`, `strict`, `noEmit`, `skipLibCheck`, `resolveJsonModule`, `isolatedModules`, `types ["vite/client"]` (тесты импортируют `describe`/`it`/`expect` из `vitest` явно); `paths {"@/*": ["./src/*"]}`; `include ["src","test","vite.config.ts","dev-proxy.ts","eslint.config.js"]`.

`vite.config.ts`: плагины `react()` и `tailwindcss()`; `resolve.alias` `@` → `./src`; `server.proxy = devProxy(loadEnv(mode, process.cwd(), ""))`; блок `test` (`/// <reference types="vitest/config" />`): `environment: "jsdom"`, `setupFiles: ["test/setup.ts"]`, `include: ["test/**/*.test.{ts,tsx}"]`.

`index.html`: `<html lang="kk" class="h-full antialiased">`, `<body class="min-h-full">`, `<div id="root">`, `<script type="module" src="/src/main.tsx">`, `<title>IMBC</title>`, `<link rel="icon" href="data:,">` (иконки IMBC нет — см. вопрос владельцу). Ни одного inline-скрипта: CSP задачи 5 допускает только `script-src 'self'`.

`src/index.css`: пока только `@import "tailwindcss";` — остальное допишет `shadcn init`. `src/main.tsx`: рендер `<div />` в `#root` (заглушка до задачи 2).

`.gitignore`: `node_modules`, `dist`, `coverage`, `*.tsbuildinfo`, `.env*`, `!.env.example`. `.env.example` — как у `apps/web/.env.example` (`API_PROXY_URL=http://localhost:3001`, `KEYCLOAK_PROXY_URL=http://localhost:8180`, комментарий «только для `pnpm dev` на хосте»).

`eslint.config.js` (flat): `globalIgnores(["dist","coverage"])`; для `**/*.{ts,tsx}` — `js.configs.recommended`, `tseslint.configs.recommended`, `reactHooks.configs.flat.recommended`, `reactRefresh.configs.vite`, `languageOptions.globals = globals.browser`; для `src/components/ui/**` правило `react-refresh/only-export-components` выключено (shadcn экспортирует варианты рядом с компонентами).

- [ ] **Step 3: Тест dev-прокси (падает)**

```ts
// test/dev-proxy.test.ts — замена rewrites из next.config.ts
it('проксирует /api и /kc на заданные адреса, как rewrites Next.js', () => {
  expect(devProxy({ API_PROXY_URL: 'http://localhost:3001', KEYCLOAK_PROXY_URL: 'http://localhost:8180' })).toEqual({
    '^/api(?:/|$)': { target: 'http://localhost:3001', changeOrigin: false, xfwd: true },
    '^/kc(?:/|$)': { target: 'http://localhost:8180', changeOrigin: false, xfwd: true },
  });
});
it('без переменных прокси нет — как в Docker и на стенде', () => {
  expect(devProxy({})).toEqual({});
  expect(devProxy({ API_PROXY_URL: '' })).toEqual({});
});
```

`test/setup.ts`: `afterEach(cleanup)` из Testing Library; заглушка `window.matchMedia` (её читает `use-mobile`), если в jsdom её нет.

Run: `pnpm --filter @imbc/web-spa test` → FAIL: `devProxy` не найден.

- [ ] **Step 4: Реализовать `devProxy`** — по Interfaces; пустая строка равна отсутствию переменной. Run: тот же → PASS.

- [ ] **Step 5: shadcn init и компоненты**

Перед добавлением — посмотреть состав (`pnpm dlx shadcn@4.23.0 view @shadcn/sidebar -c apps/web-spa`). Затем из `apps/web-spa`:

```bash
pnpm dlx shadcn@4.23.0 init --base base --preset nova --yes
pnpm dlx shadcn@4.23.0 add alert badge button card checkbox command dropdown-menu empty field input input-otp popover select separator sidebar skeleton sonner spinner table tooltip --yes
```

Ожидаемый результат (проверено на shadcn 4.23.0 с Vite 8): `components.json` со `"style": "base-nova"`, `"rsc": false`, `"tailwind.css": "src/index.css"`; зависимости `@base-ui/react`, `class-variance-authority`, `cn` (пакет shadcn-ui, заменяет `clsx` + `tailwind-merge`; `src/lib/utils.ts` реэкспортирует из него `cn`), `lucide-react`, `shadcn` (нужен ради `@import "shadcn/tailwind.css"`), `tw-animate-css`, `cmdk`, `input-otp`, `sonner`, `next-themes` (его импортирует `sonner.tsx` из реестра; от Next.js не зависит). По зависимостям реестра добавятся `dialog`, `sheet`, `input-group`, `textarea`, `label`, `hooks/use-mobile.ts`. Компоненты прежнего `apps/web`, которые приложение не использует (`avatar`, `pagination`, `radio-group`, `tabs`), не добавляются. Прежние Radix-компоненты добавлены одним коммитом каркаса и локально не правились — сливать нечего.

После CLI:
1. `src/hooks/use-mobile.ts` заменить копией `apps/web/src/hooks/use-mobile.ts` (локальная версия на `useSyncExternalStore`).
2. `src/index.css`: `init` подключает шрифт Geist — заменить на `@import "@fontsource-variable/inter";` и `--font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;` (Inter с казахскими глифами, как сейчас), пакет `@fontsource-variable/geist` удалить. Блоки `:root` и `.dark` заменить значениями из `apps/web/src/app/globals.css` (синий, белый, чёрный — NFR-15) с её шапкой-комментарием, исправив ссылку на требование на `NFR-15`; `--radius: 0.5rem`. Блок `@theme inline` пресета, импорты `tw-animate-css` и `shadcn/tailwind.css` и `@layer base` остаются как сгенерированы.
3. `pnpm install` в корне — обновить `pnpm-lock.yaml`.

- [ ] **Step 6: Тест набора компонентов**

```tsx
// test/ui-kit.test.tsx — компоненты собраны на Base UI, а не на Radix
it('ссылка с видом кнопки остаётся ссылкой (Base UI не рендерит ссылки через Button)', () => {
  render(<a className={buttonVariants({ variant: 'outline' })} href="/api/auth/login">Go</a>);
  const link = screen.getByRole('link', { name: 'Go' });
  expect(link.getAttribute('href')).toBe('/api/auth/login');
  expect(link.className).toBe(buttonVariants({ variant: 'outline' }));
});
it('Button — настоящая кнопка на Base UI', () => {
  render(<Button>Go</Button>);
  const button = screen.getByRole('button', { name: 'Go' });
  expect(button.tagName).toBe('BUTTON');
  expect(button.getAttribute('data-slot')).toBe('button');
});
```

Run: `grep -rl "radix-ui\|@radix-ui" apps/web-spa/src` → пусто. `pnpm --filter @imbc/web-spa test` → PASS.

- [ ] **Step 7: Проверка** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → PASS (собираются оба web-пакета); `get_audit_checklist` MCP shadcn — пункты выполнены.

- [ ] **Step 8: Commit** — `Web: каркас Vite SPA рядом с Next.js, shadcn/ui на Base UI (base-nova), dev-прокси /api и /kc (спецификация 11.1, NFR-15)`

---

### Task 2: языки, клиент BFF, провайдеры и корень роутера

**Files:**
- Create: `apps/web-spa/messages/{en,kk,ru}.json` (копии `apps/web/messages/*` + ключи `notFound.*`)
- Create: `apps/web-spa/src/i18n/locale.ts`, `src/i18n/messages.ts`, `src/i18n/provider.tsx`
- Create: `apps/web-spa/src/lib/api.ts`, `src/lib/auth-navigation.ts`, `src/lib/catalog-params.ts`, `src/lib/use-cooldown.ts` (копии из `apps/web/src/lib/` без `"use client"`), `src/lib/session.ts`, `src/lib/leave-app.ts`
- Create: `apps/web-spa/src/components/app/providers.tsx`, `src/components/app/page-title.tsx`, `src/components/app/locale-switcher.tsx`, `src/routes/root.tsx`, `src/routes/not-found.tsx`, `src/router.tsx`, `src/app.tsx`
- Modify: `apps/web-spa/src/main.tsx`, `apps/web-spa/package.json`, `pnpm-lock.yaml`
- Test: `test/auth-navigation.test.ts` (перенос `apps/web/test/auth-navigation.test.mjs`), `test/messages.test.ts` (перенос `messages.test.mjs`), `test/locale.test.ts`, `test/i18n.test.tsx`, `test/catalog-params.test.ts`
- Create (test): `test/support/api.ts`, `test/support/render.tsx`

**Interfaces:**
- Produces: `LOCALE_COOKIE = "NEXT_LOCALE"`, `readLocale(cookie: string): Locale`, `localeCookie(locale: Locale, secure: boolean): string` в `src/i18n/locale.ts`.
- Produces: `type Messages` (форма `en.json`), `loadMessages(locale: Locale): Promise<Messages>` — динамический `import()` файла языка (отдельный чанк) в `src/i18n/messages.ts`.
- Produces: `I18nProvider({ initialLocale, initialMessages, children })` (`IntlProvider` из `use-intl` с `timeZone="Asia/Almaty"`) и `useLocaleSwitch(): { locale: Locale; pending: boolean; change(next: Locale): Promise<void> }` в `src/i18n/provider.tsx`. `change` пишет cookie (`Secure` при `location.protocol === "https:"`), загружает переводы, меняет язык без перезагрузки и ставит `document.documentElement.lang`; если загрузка не удалась — `reloadApp()`.
- Produces: `leaveApp(url: string, options?: { replace?: boolean }): void` (уход со SPA: `location.assign`/`location.replace`) и `reloadApp(): void` в `src/lib/leave-app.ts` — тесты подменяют модуль через `vi.mock`.
- Produces: `useMe()`, `meKey`, `type Me`, `useLogout()` в `src/lib/session.ts` — как в `apps/web`, но `useLogout` уходит через `leaveApp(redirectTo)`, а при 401 — `navigate("/login", { replace: true })` (`useNavigate` React Router).
- Produces: `Providers({ initialLocale, initialMessages, queryClient?, children })` — `QueryClientProvider` (настройки и `QueryCache.onError` как в `apps/web/src/components/app/providers.tsx`), `I18nProvider`, `TooltipProvider`, `Toaster richColors position="top-right"`, `ReactQueryDevtools`. `PageTitle({ title }: { title?: string })` — рендерит `<title>` (React 19 поднимает его в `<head>`): `` `${title} · ${appName}` `` или `appName`, как шаблон `generateMetadata` Next.
- Produces: `routes: RouteObject[]` и `createAppRouter(): Router` в `src/router.tsx`. Корень — `src/routes/root.tsx`: `<NuqsAdapter>` из `nuqs/adapters/react-router/v8` вокруг `<Outlet />` и `<ScrollRestoration />`; дочерний `{ path: "*", element: <NotFoundPage /> }`. Задачи 3 и 4 добавляют детей корня.
- Produces (тесты): `stubApi(handlers: Record<string, ApiReply>): Mock` — подменяет `fetch`, ключ `"GET /api/auth/me"`, `ApiReply = { status?: number; body?: unknown } | ((url: URL, init?: RequestInit) => Response)`, неизвестный путь → 404 problem+json; `problem(status: number, code: string): ApiReply`. `renderRoute(entry: string, options?: { locale?: Locale; routes?: RouteObject[] }): { router: ReturnType<typeof createMemoryRouter>; user: UserEvent }` — `createMemoryRouter(routes, { initialEntries: [entry] })` внутри `Providers` с новым `QueryClient` (`retry: false`) и переводами из JSON.

- [ ] **Step 1: Зависимости** — `react-router ^8.5.1`, `nuqs ^2.10.2`, `use-intl ^4.14.9`, `@tanstack/react-query ^5.107.1`, `@tanstack/react-query-devtools ^5.107.1`, `zod ^4.6.7`, `@imbc/contracts workspace:*`; `pnpm install`.

- [ ] **Step 2: Тесты (падают)**

`auth-navigation.test.ts` и `messages.test.ts` — те же утверждения, что в `apps/web/test/*.test.mjs` на момент задачи (если этап 0 сменил стартовые страницы ролей в `@imbc/contracts`, ожидания следуют контрактам). В `messages.test.ts` эталон — `en` (LANG-02):

```ts
it('kk и ru содержат ровно ключи en — английский исходный (LANG-02)', ...);
it('плейсхолдеры ICU каждой строки совпадают с en', ...);   // множества имён из /\{(\w+)/g равны по ключу
it('пустых строк нет', ...);
```

```ts
// test/locale.test.ts (LANG-01)
expect(readLocale('')).toBe('kk');
expect(readLocale('imbc-device=x; NEXT_LOCALE=ru')).toBe('ru');
expect(readLocale('NEXT_LOCALE=de')).toBe('kk');
expect(readLocale('NEXT_LOCALE=en; NEXT_LOCALE=ru')).toBe('en');   // первая — с более точным Path
expect(localeCookie('ru', false)).toBe('NEXT_LOCALE=ru; Path=/; Max-Age=31536000; SameSite=Lax');
expect(localeCookie('en', true)).toBe('NEXT_LOCALE=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
```

```tsx
// test/i18n.test.tsx
it('числа и даты следуют языку и часовому поясу Asia/Almaty (LANG-04)', ...);
// проба useFormatter: format.number(1234567.5) и format.dateTime(new Date('2026-11-11T20:00:00Z'), { dateStyle: 'medium' });
// для ru и en текст равен new Intl.NumberFormat(locale).format(…) и
// new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Asia/Almaty' }).format(…); для en дата — 'Nov 12, 2026'
it('переключатель меняет язык без перезагрузки и не трогает адрес (LANG-01, OPR-05)', ...);
// renderRoute('/catalog?q=steel', { routes: [пробный маршрут с LocaleSwitcher и строкой common.appName] });
// выбрать «Русский» → видно «Платформа IMBC»; document.cookie содержит NEXT_LOCALE=ru;
// document.documentElement.lang === 'ru'; router.state.location: pathname '/catalog', search '?q=steel'
it('если файл переводов не загрузился (вкладка старше выката), cookie записан и страница перезагружается', ...);
// vi.mock('@/i18n/messages') — loadMessages отклоняет; vi.mock('@/lib/leave-app'); после выбора en → reloadApp вызван, cookie NEXT_LOCALE=en
it('неизвестный адрес показывает страницу «не найдено» на языке пользователя', ...);
// renderRoute('/no-such-page', { locale: 'ru' }) → заголовок «Страница не найдена», ссылка на '/'
```

```ts
// test/catalog-params.test.ts (OPR-05)
it('адрес из README разбирается nuqs и catalogFilterSchema одинаково', ...);
// query = serializeCatalog({ q: 'металл', region: ['KZ-ATY','KZ-MAN'], group: ['A','B'], surveyed: true,
//                            tnved: '7308', sort: 'verified_at', page: 2 });
// catalogFilterSchema.parse(Object.fromEntries(new URLSearchParams(query))) даёт те же значения;
// region и group в query — через запятую, без повторения ключа
it('значения по умолчанию в адрес не попадают', () => expect(serializeCatalog({ sort: 'name', page: 1 })).toBe(''));
```

Run: `pnpm --filter @imbc/web-spa test` → FAIL: модулей нет.

- [ ] **Step 3: Переводы** — скопировать три файла; добавить:

| Ключ | en | ru | kk |
|---|---|---|---|
| `notFound.title` | Page not found | Страница не найдена | Бет табылмады |
| `notFound.description` | The address may be mistyped, or the page has moved. | Возможно, адрес набран с ошибкой или страница перемещена. | Мекенжай қате терілген немесе бет көшірілген болуы мүмкін. |
| `notFound.home` | Go to the start page | На главную | Басты бетке |

- [ ] **Step 4: Реализация** — модули по Interfaces. `LocaleSwitcher`: разметка и подписи как в `apps/web/src/components/app/locale-switcher.tsx`; `DropdownMenuTrigger render={<Button variant={variant} size="sm" disabled={pending} aria-label={t("language")} />}`; `onValueChange` принимает значение, только если оно входит в `LOCALES`. `NotFoundPage`: `Card` с `notFound.*`, ссылка `<Link className={buttonVariants()} to="/">`, `PageTitle title={t("title")}`. `main.tsx`: импорт `@fontsource-variable/inter` и `./index.css`; `const locale = readLocale(document.cookie)`; `loadMessages(locale).then((messages) => createRoot(…).render(<StrictMode><App initialLocale={locale} initialMessages={messages} /></StrictMode>))`; `document.documentElement.lang = locale`. `App` = `Providers` + `<RouterProvider router={createAppRouter()} />`.

- [ ] **Step 5: Запустить** — `pnpm --filter @imbc/web-spa test` → PASS; `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → PASS.

- [ ] **Step 6: Commit** — `Web SPA: языки kk/ru/en в cookie NEXT_LOCALE, форматы по языку, клиент BFF, роутер и nuqs (LANG-01, LANG-02, LANG-04, OPR-05)`

---

### Task 3: путь входа — `/`, `/login`, `/register`, `/auth/verify`, `/auth/responsibility`, логотип

**Files:**
- Create: `apps/web-spa/src/assets/imbc-logo.png` — копия файла `/private/tmp/claude-501/-Users-batyrbekkuandyk-Desktop-imbc-platform/af493c61-e770-4ebe-a016-52c755fe890a/images/5.png` (вне репозитория; `cp` по абсолютному пути и коммит вместе с задачей). Если файла нет — остановиться и запросить его у владельца.
- Create: `src/components/app/logo.tsx`, `src/components/auth/session-status.tsx`, `src/components/auth/session-exit.tsx`, `src/lib/login-state.ts`
- Create: `src/routes/home.tsx`, `src/routes/auth/layout.tsx`, `src/routes/auth/login.tsx`, `src/routes/auth/register.tsx`, `src/routes/auth/register-form.tsx`, `src/routes/auth/verify.tsx`, `src/routes/auth/verify-form.tsx`, `src/routes/auth/responsibility.tsx`, `src/routes/auth/accept-button.tsx`
- Modify: `src/router.tsx`, `messages/{en,kk,ru}.json` (`common.logoAlt`)
- Test: `test/login-state.test.ts`, `test/auth-routes.test.tsx`

Источник каждой страницы — одноимённый файл в `apps/web/src/app/(auth)/…` и `apps/web/src/app/page.tsx`: разметка, тексты, запросы и переходы сохраняются; меняются только механизмы Next (таблица ниже).

| Next.js | Vite SPA |
|---|---|
| `useRouter().replace(x)` | `useNavigate()(x, { replace: true })` |
| `searchParams` страницы | `useSearchParams()`; `returnTo` — `safeReturnTo(params.get("returnTo"))` |
| `getTranslations`/`getLocale` (сервер) | `useTranslations`/`useLocale` из `use-intl` |
| `generateMetadata` | `<PageTitle title={t("title")} />` — только там, где был `generateMetadata` (`/login`, `/register`) |
| `redirect(loginUrl(…))` на сервере в `/login` | `resolveLoginState` + `leaveApp(url, { replace: true })` в эффекте, пока — `SessionStatus` |
| `next/link` | `Link to` React Router; `<a href>` — для `/api/*` |
| `Button asChild` + `<a>`/`<Link>` | `<a className={buttonVariants({…})} href=…>` / `<Link className={buttonVariants({…})} to=…>` — ссылка остаётся ссылкой (Global Constraints, отличия Base UI, п. 2) |
| `"use client"` | удаляется |

**Interfaces:**
- Consumes: `renderRoute`, `stubApi`, `problem`, `leaveApp`, `useMe`, `useLogout`, `PageTitle`, `LocaleSwitcher`, `routes` (задача 2).
- Produces: `LOGIN_ERRORS = ["flow_expired","oidc","no_account","account_inactive","email_unverified","session_expired"] as const`; `resolveLoginState(params: URLSearchParams, locale: Locale): { kind: "redirect"; url: string } | { kind: "error"; error: (typeof LOGIN_ERRORS)[number]; target: string } | { kind: "signedOut"; target: string }` в `src/lib/login-state.ts` — логика `apps/web/src/app/(auth)/login/page.tsx`: известная ошибка → она; любая другая непустая `error` → `oidc`; `logged_out=1` без ошибки → `signedOut`; иначе → `redirect` на `loginUrl(safeReturnTo(returnTo), locale)`.
- Produces: `Logo({ className, plate }: { className?: string; plate?: boolean })` — `<img src={logoUrl} alt={t("common.logoAlt")} width={736} height={212}>` (высоту задаёт класс, ширина `w-auto`); `plate` кладёт его на тёмно-синюю подложку `rounded-md bg-sidebar px-2.5 py-1.5`. Логотип серебристый на прозрачном фоне: на белом он почти не читается, поэтому на светлых поверхностях — только с подложкой; перерисовка и обрезка логотипа не допускаются (NFR-15).
- Produces: маршруты-дети корня: `{ index: true, element: <HomePage /> }` и layout `AuthLayout` (`<Outlet />`) с детьми `login`, `register`, `auth/verify`, `auth/responsibility`.

- [ ] **Step 1: Тесты (падают)**

```ts
// test/login-state.test.ts
expect(resolveLoginState(new URLSearchParams('returnTo=/catalog?q=steel'), 'kk'))
  .toEqual({ kind: 'redirect', url: '/api/auth/login?returnTo=%2Fcatalog%3Fq%3Dsteel&locale=kk' });
expect(resolveLoginState(new URLSearchParams('returnTo=https://evil.example'), 'ru'))
  .toEqual({ kind: 'redirect', url: '/api/auth/login?returnTo=%2F&locale=ru' });
expect(resolveLoginState(new URLSearchParams('error=no_account'), 'kk')).toEqual({ kind: 'error', error: 'no_account', target: '/' });
expect(resolveLoginState(new URLSearchParams('error=whatever'), 'kk')).toMatchObject({ kind: 'error', error: 'oidc' });
expect(resolveLoginState(new URLSearchParams('logged_out=1'), 'kk')).toEqual({ kind: 'signedOut', target: '/' });
expect(resolveLoginState(new URLSearchParams('logged_out=1&error=oidc'), 'kk')).toMatchObject({ kind: 'error' });
```

```tsx
// test/auth-routes.test.tsx — vi.mock('@/lib/leave-app')
it('/login без ошибки уводит в BFF с returnTo и языком (ADR-04)', ...);
// renderRoute('/login?returnTo=%2Fcatalog') → leaveApp('/api/auth/login?returnTo=%2Fcatalog&locale=kk', { replace: true })
it('/login?error=no_account: сообщение и вход другим адресом с prompt=login', ...);
// alert с login.errors.no_account (kk); ссылка login.useAnotherEmail с href
// '/api/auth/login?returnTo=%2F&locale=kk&prompt=login'; ссылка «Тіркелу» ведёт на /register; leaveApp не вызван
it('/login?logged_out=1 показывает «Вы вышли» (ru)', ...);
it('/ без сеанса → /login; без второго фактора → /auth/verify?returnTo=…; без ответственности → /auth/responsibility?returnTo=…', ...);
// stubApi: me → problem(401,'unauthorized') | { gates: { mfa: false, … } } | { gates: { mfa: true, responsibility: false } }
it('/auth/verify при истёкшем сеансе → /login?error=session_expired&returnTo=%2Fcatalog', ...);
it('/auth/verify с пройденным вторым фактором и ответственностью → стартовая страница роли', ...);
// me оператора с gates { mfa: true, responsibility: true }, returnTo=/catalog → location.pathname '/catalog'
it('/auth/responsibility: принять → POST /api/auth/responsibility и переход на returnTo', ...);
it('согласие с условиями ставится кликом по подписи и пробелом (Review Focus 4)', ...);
// renderRoute('/register'); click по тексту register.acceptTerms → чекбокс checked; ещё раз Space на чекбоксе → unchecked
it('регистрация отправляет форму с языком интерфейса и показывает ошибку БИН с сервера', ...);
// БИН с верной контрольной цифрой — из тестов packages/contracts (checkBin), email *.local;
// stubApi: 'POST /api/v1/registrations' → problem(409,'bin_exists'); тело запроса содержит locale: 'kk';
// под полем БИН — register.errors.bin_exists
```

Run: `pnpm --filter @imbc/web-spa test` → FAIL.

- [ ] **Step 2: Логотип** — `cp '/private/tmp/claude-501/-Users-batyrbekkuandyk-Desktop-imbc-platform/af493c61-e770-4ebe-a016-52c755fe890a/images/5.png' apps/web-spa/src/assets/imbc-logo.png`; `file` → `PNG image data, 736 x 212, 8-bit/color RGBA`. Ключ `common.logoAlt` во всех трёх файлах: `IMBC — International Machine Building Center` (собственное имя с логотипа, не переводится; LANG-05).

- [ ] **Step 3: Реализация**

`AuthLayout` — разметка `apps/web/src/app/(auth)/layout.tsx` с двумя заменами: в шапке вместо `BrandMark` — `<Logo plate className="h-6" />` и рядом `appName` (`hidden sm:inline`), ссылка `Link to="/login"`; в левой колонке (lg) вместо плитки с `Building2Icon` — `<Logo plate className="h-12" />`, подложка `rounded-2xl p-4 shadow-lg shadow-primary/15`. `BrandMark` не переносится. Страницы и формы — по таблице выше. `Checkbox`: `onCheckedChange={(checked) => …acceptTerms: checked === true}`. `InputOTP` — пропсы как в `verify-form.tsx` (`containerClassName`, `maxLength`, `pattern`, `autoComplete="one-time-code"`). Если клик по подписи не переключает чекбокс Base UI, связать их обёрткой `<FieldLabel>` вокруг `Checkbox` и текста (пример `field` в реестре base-nova: `pnpm dlx shadcn@4.23.0 view @shadcn/field -c apps/web-spa`), а не обработчиком клика.

- [ ] **Step 4: Запустить** — `pnpm --filter @imbc/web-spa test` → PASS; `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → PASS.

- [ ] **Step 5: Commit** — `Web SPA: вход, регистрация, код из письма и ответственность на прежних адресах, логотип IMBC (AUTH-01, AUTH-03, AUTH-10, MAN-02, NFR-15)`

---

### Task 4: оболочка и рабочие страницы — `/catalog`, `/dashboard`, `/account`, `/profile`

**Files:**
- Create: `src/components/app/app-shell.tsx`, `src/routes/app/catalog.tsx`, `src/routes/app/catalog-view.tsx`, `src/routes/app/dashboard.tsx`, `src/routes/app/account.tsx`, `src/routes/app/profile.tsx`
- Modify: `src/router.tsx`
- Test: `test/app-shell.test.tsx`, `test/catalog.test.tsx`

Источник — `apps/web/src/components/app/app-shell.tsx` и `apps/web/src/app/(app)/*`; замены — как в таблице задачи 3 (`usePathname()` → `useLocation().pathname`, `pathname + window.location.search` → `pathname + search` из `useLocation()`). `Suspense` вокруг `CatalogView` не нужен (его требовал nuqs под Next) и удаляется. `PageTitle` — на `/catalog`, `/dashboard`, `/account`.

**Interfaces:**
- Consumes: всё из задач 2 и 3; `Logo`.
- Produces: layout-маршрут `AppShell` (`<Outlet />` вместо `children`) с детьми `catalog`, `dashboard`, `account`, `profile`.

Отличия Base UI в этой задаче:
- `SidebarMenuButton render={<Link to={i.href} />} isActive={pathname.startsWith(i.href)} tooltip={i.label}` с `<i.icon />` и `<span>` детьми.
- `MultiPick`: `PopoverTrigger render={<Button variant="outline" className="justify-between" />}`; `Command`/`CommandItem` (cmdk) — как были.
- Три `Select`: корень получает `items` — для «Обследование» и «Единый реестр» `[{ value: "any", label: common("any") }, { value: "true", label: common("yes") }, { value: "false", label: common("no") }]`, для сортировки `name`/`verified_at`/`region` с `t("sortName")`, `t("sortVerified")`, `t("sortRegion")`; `onValueChange` игнорирует `null`.
- Шапка сайдбара: `<Logo className="h-7" />` (сайдбар тёмно-синий — подложка не нужна), скрыт в свёрнутом режиме (`group-data-[collapsible=icon]:hidden`); `appName` — `sr-only`. Квадратного знака IMBC нет, поэтому свёрнутый сайдбар остаётся без логотипа (вопрос владельцу).
- Ссылки с видом кнопки: `/account` в профиле — `<Link className={buttonVariants({…})} to="/account">`, сброс пароля — `<a className={buttonVariants({…})} href={passwordResetUrl("/account", locale)}>`; варианты и размеры — как у прежних кнопок.
- Плитки и строки дашборда — `Link to={`/catalog${serializeCatalog(…)}`}`.

Правила и замечания ревью задачи 2, закрываются в этой задаче:
- Каждая страница, включая состояния загрузки и перенаправления, рендерит ровно один `PageTitle`; `AppShell` — ни одного (React 19 поднимает первый `<title>`, заголовок layout перебил бы заголовок страницы).
- В тестах свои `routes` для `renderRoute` оборачиваются в `{ element: <Root />, children }`, если им нужен nuqs; `QueryClient` создаётся только через `renderRoute` (`createQueryClient`), не `new QueryClient`.
- Страницы `/catalog`, `/dashboard`, `/account`, `/profile` подключаются в `src/router.tsx` через `lazy` маршрута React Router — отдельный чанк на страницу (основной чанк после задачи 2 — 555 kB); страницы входа из задачи 3 остаются в основном чанке.
- `src/main.tsx`: у `loadMessages(locale).then(…)` появляется `.catch` — одна перезагрузка с флагом в `sessionStorage` (ставится перед `reloadApp()`, снимается после успешного рендера), чтобы сбой загрузки файла переводов на старте не оставлял пустую страницу и не зацикливался. Тест: при отклонении `loadMessages` `reloadApp` вызван один раз; при повторном отклонении с выставленным флагом — не вызван.
- `src/i18n/provider.tsx`: два вызова `change` подряд — побеждает последний запрошенный язык (проверка через `useRef`); тест на гонку.
- Заглушка `window.scrollTo` переезжает из `test/support/render.tsx` в `test/setup.ts`.

- [ ] **Step 1: Тесты (падают)**

```tsx
// test/app-shell.test.tsx (GEN-08, GEN-10: интерфейс прячет, решает сервер)
it('истёкший сеанс → вход с возвратом на страницу и фильтры', ...);
// renderRoute('/catalog?q=steel'), me → problem(401,'unauthorized')
// → location '/login', search '?error=session_expired&returnTo=%2Fcatalog%3Fq%3Dsteel'
it('нет второго фактора → /auth/verify?returnTo=%2Fdashboard', ...);
it('производитель на /catalog уходит на /profile; администратор на /dashboard — на /account', ...);
it('меню наблюдателя: каталог, дашборд, аккаунт — без профиля компании', ...);
// ссылки с href '/catalog', '/dashboard', '/account'; ссылки '/profile' нет
it('выход: POST /api/auth/logout и уход на redirectTo через leaveApp', ...);
```

```tsx
// test/catalog.test.tsx (OPR-04, OPR-05); me — оператор с пройденными шлюзами
it('фильтры из адреса уходят в API без преобразований', ...);
// renderRoute('/catalog?region=KZ-ATY,KZ-MAN&group=A,B&surveyed=true&sort=verified_at&page=2')
// → fetch '/api/v1/catalog/search?region=KZ-ATY,KZ-MAN&group=A,B&surveyed=true&sort=verified_at&page=2'
it('закодированная запятая в ссылке даёт тот же запрос (Review Focus 1)', ...);
// '/catalog?region=KZ-ATY%2CKZ-MAN' → тот же URL запроса, что для '?region=KZ-ATY,KZ-MAN'
it('селект показывает подпись, а не значение из адреса (Review Focus 5)', ...);
// '/catalog?surveyed=true' (ru) → в кнопке фильтра «Да», текста 'true' нет
it('«Сбросить» очищает адрес и повторяет поиск без фильтров', ...);
// после клика location.search === '' и последний fetch — '/api/v1/catalog/search'
it('дата верификации — в формате языка (LANG-04)', ...);
// строка с verifiedAt '2026-11-11T20:00:00Z', locale en → ячейка 'Nov 12, 2026'
```

Run: `pnpm --filter @imbc/web-spa test` → FAIL.

- [ ] **Step 2: Реализация** — по Interfaces и списку выше.

- [ ] **Step 3: Запустить** — `pnpm --filter @imbc/web-spa test` → PASS; `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → PASS.

- [ ] **Step 4: Ручная проверка на dev-сервере** — `cp apps/web-spa/.env.example apps/web-spa/.env.local`, `pnpm --filter @imbc/web-spa dev`, `http://localhost:3010/no-such-page` → страница «не найдено» на казахском; без запущенного API `/catalog` показывает ошибку соединения с кнопкой повтора, а не пустой экран. Полный путь — в задаче 5.

- [ ] **Step 5: Commit** — `Web SPA: оболочка по матрице прав, каталог с фильтрами в адресе, дашборд, аккаунт и профиль (GEN-10, OPR-04, OPR-05, OPR-35, LANG-04)`

---

### Task 5: переключение — Next.js удалён, SPA в `apps/web`, образ на nginx

**Files:**
- Delete: всё Next-приложение `apps/web/**` (в т. ч. `next.config.ts`, `next-env.d.ts`, `src/app/**`, `src/i18n/request.ts`, `src/components/**`, `src/lib/**`, `src/hooks/**`, `test/*.mjs`, `components.json`, `eslint.config.mjs`, `tsconfig.json`, `.prettierrc`, `AGENTS.md`, `src/app/favicon.ico` — иконка create-next-app)
- Move: `apps/web-spa/**` → `apps/web/**` (`git mv`)
- Modify: `apps/web/package.json` (`"name": "@imbc/web"`, порт 3000 в `dev` и `preview`), `turbo.json` (из `build.outputs` убрать `.next/**` и `!.next/cache/**`), `.gitignore` (строка `.next/`), `.dockerignore` (`**/.next`, исключение `!apps/web/AGENTS.md`), `.prettierignore` (`**/.next`, `**/next-env.d.ts`), `pnpm-workspace.yaml` (`sharp`, `unrs-resolver` — только если `pnpm why` не находит других пакетов), `pnpm-lock.yaml`, `infrastructure/docker/web.Dockerfile`, `compose.dev.yaml` (комментарий строки 3: «Vite проксирует /api и /kc»), `CLAUDE.md`, `AGENTS.md`
- Create: `infrastructure/nginx/web.conf`, `apps/web/AGENTS.md` (новый), `apps/web/.prettierrc` (копия прежнего)
- Test: `apps/web/test/index-html.test.ts`
- Без изменений (проверить, что правка не нужна): `infrastructure/nginx/nginx.conf`, `infrastructure/azure/Caddyfile`, `compose.yaml`, `compose.azure.yaml`, `Makefile`, `.github/workflows/ci.yml`, `infrastructure/azure/deploy.sh` (его `--exclude=.next` безвреден, `dist` уже исключён), `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` (указывают на `apps/web` — теперь там `base-nova`)

**Interfaces:**
- Produces: пакет `@imbc/web` в `apps/web`, `pnpm dev` → web на `:3000`; образ `imbc/web` слушает `3000` без root.

- [ ] **Step 1: Сверить, что `apps/web` не менялся после начала ветки**

Run: `git log --oneline $(git merge-base HEAD feat/spec-v1.3-contracts)..feat/spec-v1.3-contracts -- apps/web` и `git diff --stat $(git merge-base HEAD feat/spec-v1.3-contracts) feat/spec-v1.3-contracts -- apps/web`
Expected: пусто. Иначе (этап 0 изменил web, например добавил тир) — сначала перенести эти изменения в `apps/web-spa` с тестами, отдельным коммитом этой задачи, и только потом удалять.

- [ ] **Step 2: Тест `index.html` под CSP (падает, пока в шаблоне есть inline-скрипт; иначе — проходит сразу и фиксирует правило)**

```ts
// test/index-html.test.ts — CSP задачи разрешает только script-src 'self'
it('в index.html нет inline-скриптов', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  expect(html.match(/<script(?![^>]*\bsrc=)[^>]*>/g)).toBeNull();
});
```

- [ ] **Step 3: Перенос и переименование** — `git rm -r` Next-файлов, `git mv apps/web-spa/* apps/web/` (включая скрытые `.gitignore`, `.env.example`), правки файлов из списка, `pnpm install`. Проверка: `grep -rIn -e '"next"' -e 'next-intl' -e 'next/' -e 'NEXT_TELEMETRY' -e '\.next' --exclude-dir={node_modules,dist,.turbo} apps/web infrastructure/docker turbo.json .gitignore .dockerignore .prettierignore` → пусто (`NEXT_LOCALE` и `next-themes` в выборку не попадают и остаются). `pnpm why next` → не найден.

Замечания ревью задачи 1, закрываются в этой задаче (после переноса, в `apps/web`):
- ключи dev-прокси — `^/api(?:[/?#]|$)` и `^/kc(?:[/?#]|$)`: Vite сравнивает ключ с адресом вместе с query, и прежний ключ не пропускал `/api?x=1`; ожидания `test/dev-proxy.test.ts` меняются, и добавляется проверка поведения: `new RegExp(key)` принимает `/api`, `/api/x`, `/api?x=1` и отклоняет `/apix`;
- `vite.config.ts` читает переменные из каталога пакета (`fileURLToPath(new URL(".", import.meta.url))`), а не из `process.cwd()`: запуск с `--config` из корня не должен молча оставлять прокси пустым.

- [ ] **Step 4: Образ** — `infrastructure/docker/web.Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
# Web UI: статическая сборка Vite (спецификация 11.1), nginx без root на :3000 — адрес web:3000 прежний.
ARG NODE_VERSION=26
ARG PNPM_VERSION=10.28.0
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29-alpine

FROM node:${NODE_VERSION}-alpine AS build
# … установка pnpm, pnpm install --frozen-lockfile --filter @imbc/web..., копирование contracts и web —
# как в прежнем файле; затем: pnpm --filter @imbc/contracts build && pnpm --filter @imbc/web build

FROM ${NGINX_IMAGE} AS runtime
COPY infrastructure/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 3000
```

`infrastructure/nginx/web.conf`:

```nginx
# Статика Web UI. Заголовки nosniff, Referrer-Policy, X-Frame-Options и HSTS ставит edge (nginx.conf, Caddyfile);
# здесь — только CSP и кеширование, чтобы заголовки не дублировались.
server {
  listen 3000;
  server_tokens off;
  root /usr/share/nginx/html;

  # Хешированные файлы Vite. Отсутствующий файл — 404, не index.html (вкладка старше выката).
  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
  }

  # Любой адрес приложения — index.html: маршруты решает React Router.
  location / {
    add_header Cache-Control "no-cache";
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
    try_files $uri /index.html;
  }
}
```

`style-src 'unsafe-inline'` нужен для атрибутов `style` (полосы регионов на дашборде, позиционирование Base UI, sonner). `frame-ancestors 'self'` совпадает с `X-Frame-Options: SAMEORIGIN` Caddy.

- [ ] **Step 5: Документы для исполнителей** — `CLAUDE.md`, строка 3: `apps/web` (React + Vite SPA, React Router, shadcn/ui на Base UI `base-nova`). `AGENTS.md`: первый пункт — shadcn/ui на Base UI, пресет `base-nova`; пункт про web — «Read `apps/web/AGENTS.md` before changing web code» (без документации Next.js). `apps/web/AGENTS.md` (английский, как остальные AGENTS): стек; маршруты в `src/router.tsx`; `asChild` → `render`, ссылка с видом кнопки — `<a|Link className={buttonVariants()}>`, а не `Button render`, `Select items`, `TooltipProvider` — список из Global Constraints; `/api` и `/kc` только через `<a href>`/`leaveApp`; переводы в `messages/` — en исходный, три файла с одинаковыми ключами; cookie `NEXT_LOCALE` общий с темой Keycloak; фильтры каталога — `src/lib/catalog-params.ts` в формате `catalogFilterSchema`; без inline-скриптов (CSP в `infrastructure/nginx/web.conf`); компоненты — `pnpm dlx shadcn@latest add` из `apps/web` или MCP shadcn; тесты — `pnpm --filter @imbc/web test`.

- [ ] **Step 6: Проверки сборки**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → PASS.
Run: `docker compose config -q` → без вывода.
Run: `docker build -f infrastructure/docker/web.Dockerfile -t imbc/web:vite-check .` → успешно.
Run: `docker run -d --rm --name imbc-web-check -p 3999:3000 imbc/web:vite-check`, затем:
- `curl -sI localhost:3999/catalog?q=steel` → `200`, `Content-Type: text/html`, `Cache-Control: no-cache`, есть `Content-Security-Policy`;
- `curl -sI localhost:3999/assets/$(ls apps/web/dist/assets | grep -m1 '\.js$')` → `200`, `immutable`;
- `curl -sI localhost:3999/assets/missing-0000.js` → `404`;
- `docker exec imbc-web-check id -u` → не `0`; `docker stop imbc-web-check`.

Если Docker недоступен — шаги 6–7 записать в отчёт задачи как невыполненные; переключение без них не считается принятым.

- [ ] **Step 7: Сквозная проверка в браузере на локальном стенде**

Стенд поднимается в worktree отдельным проектом Compose, чтобы не задеть стенд владельца (`compose.yaml` задаёт `name: imbc`, флаг `-p` его перекрывает):

```bash
make env && make secrets        # .env в worktree, не коммитится
# в .env: HTTP_PORT=8088, PUBLIC_URL=http://localhost:8088, RUSTFS_CONSOLE_PORT=19001, MAILPIT_UI_PORT=18025
docker compose -p imbc-webspa up -d --build nginx mailpit
docker compose -p imbc-webspa ps     # migrate завершился, api healthy, keycloak healthy
```

Вход — демо-аккаунты seed с паролем из `KEYCLOAK_DEV_USER_PASSWORD` в `.env` (значение не выводить); код из письма — в Mailpit `http://localhost:18025` (адреса `.local` наружу не уходят). Форма пароля локально — стандартная тема Keycloak (тема IMBC собирается только Azure-overlay). Проверить в Chrome (DevTools: Network, Console) и записать результат по пунктам:

1. `http://localhost:8088/` → `/login` → переход на `/kc/realms/imbc/…`; после пароля оператора `operator@operator.local` → `/auth/verify?returnTo=…` с логотипом в шапке → код из Mailpit → `/auth/responsibility` (первый вход) → стартовая страница роли.
2. Вставить в адрес `/catalog?region=KZ-ATY&group=A,B&surveyed=true&sort=verified_at` и обновить страницу: фильтры выбраны, в Network — `GET /api/v1/catalog/search?region=KZ-ATY&group=A,B&surveyed=true&sort=verified_at`. Сменить фильтр → адрес меняется; «Назад» возвращает прежний поиск; «Скопировать ссылку» копирует текущий адрес.
3. Язык: русский → тексты и даты в таблице на русском, адрес не изменился; обновление страницы — язык сохранён; cookie `NEXT_LOCALE=ru`; после удаления cookie — казахский.
4. Обновление страницы на `/dashboard` и `/account` — открываются (SPA-fallback); `/no-such-page` — страница «не найдено»; плитка дашборда ведёт в каталог с фильтром.
5. `curl -sI http://localhost:8088/catalog` — `Content-Security-Policy` один раз, `X-Content-Type-Options` один раз; в Console нет нарушений CSP и ошибок.
6. Выход → `/login?logged_out=1` с карточкой «Вы вышли».
7. `manufacturer@demo.local` → `/profile`; ручной переход на `/catalog` возвращает на `/profile`.
8. Ширина 390 px: сайдбар открывается шторкой, тексты не обрезаны (NFR-14).
9. `/register` с адресом `*.local`: письмо пришло в Mailpit.

Dev-прокси: `API_PROXY_URL=http://localhost:8088 KEYCLOAK_PROXY_URL=http://localhost:8088 pnpm --filter @imbc/web dev`, затем `curl -s localhost:3000/api/health/ready` → ответ API, `curl -sI localhost:3000/kc/realms/imbc/.well-known/openid-configuration` → `200`. Полный вход через dev-сервер здесь не проверяется: realm стенда зарегистрирован на `PUBLIC_URL` `:8088`; это проверяет разработчик в режиме `make infra` с `PUBLIC_URL=http://localhost:3000`.

После проверки: `docker compose -p imbc-webspa down -v`.

Остаётся непроверенным до dev-стенда Azure: CSP вместе с заголовками Caddy на HTTPS, cookie `NEXT_LOCALE` с `Secure`, записанный темой IMBC в Keycloak и прочитанный SPA, доставка реальной почты.

- [ ] **Step 8: Commit** — `Web переведён на Vite SPA: Next.js удалён, образ web — статика на nginx с CSP, адреса и поведение сохранены (спецификация 11.1, LANG-01, OPR-05, NFR-11)`

---

### Task 6: README, архитектура, handoff и итоговая проверка

**Files:**
- Modify: `README.md`, `docs/architecture/README.md` (строка 4), `docs/handoff/2026-11-11-context.md` (§3, §4, §7 вопрос 1)

- [ ] **Step 1: README**
  - §1, схема: `W[Web UI<br/>React + Vite SPA]`.
  - §2: строку «Web UI» удалить — реализация совпадает с архитектурой (§5, §14) и спецификацией 11.1; строка «Библиотека компонентов»: **shadcn/ui на Base UI, пресет `base-nova`**, «решение владельца 11.11.2026, как в прототипе аналитика». Под таблицей одна строка: с 11.11.2026 web — Vite SPA, сеансы, OIDC и права по-прежнему в BFF.
  - §3: строка `web/` — «React 19 + Vite SPA, React Router, shadcn/ui (Base UI), TanStack Query, nuqs, use-intl»; подкаталоги `src/routes/` (`auth/` — вход, регистрация, код, ответственность; `app/` — каталог, дашборд, профиль, аккаунт за `AppShell`), `src/i18n/`, `src/assets/` (логотип IMBC).
  - §5: `web` — `imbc/web` (nginx, статика Vite, CSP), порт внутри сети `3000`.
  - §9: nuqs с адаптером React Router; ссылка и формат без изменений.
  - §10: Vite + React Router вместо Next.js; shadcn/ui на Base UI (`base-nova`), тема IMBC — переменные в `apps/web/src/index.css`; use-intl, язык в cookie `NEXT_LOCALE` (общий с темой Keycloak), часовой пояс Asia/Almaty; логотип IMBC; CSP и кеширование в `infrastructure/nginx/web.conf`; тема Keycloak пока на Radix `new-york` — перевод отдельным планом.
  - §12: «Vite проксирует `/api` и `/kc`…» (переменные те же, файл `apps/web/.env.local`); команда добавления компонента — `pnpm dlx shadcn@latest add <компонент>` из `apps/web`.
  - §14: строка `@imbc/web` — число тестов Vitest по фактическому прогону этой ветки, с датой; локальная браузерная проверка задачи 5 (что проверено, что осталось до стенда).
- [ ] **Step 2: `docs/architecture/README.md`** — из списка отличий убрать «Web UI на Next.js App Router вместо Vite SPA»; shadcn — «shadcn/ui на Base UI (base-nova)».
- [ ] **Step 3: `docs/handoff/2026-11-11-context.md`** — в §3 строка `11.11 | Web UI переведён на React + Vite SPA (спецификация 11.1), shadcn/ui — Base UI, пресет base-nova; сеансы, OIDC и права — в BFF`; строку 09.11 о Next.js оставить как историю; в §4 `apps/web (Next.js 16)` → `apps/web (Vite SPA)`; вопрос 1 в §7 — «решено владельцем 11.11: Vite SPA; CASL — по-прежнему открыт». При конфликте с правками этапа 0 сохранить обе.
- [ ] **Step 4: Итоговая проверка**

Run: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build` → PASS.
Run: `docker compose config -q` и `docker build -f infrastructure/docker/web.Dockerfile -t imbc/web:vite-check .` → успешно.
Браузерная проверка — пункты 1–9 шага 7 задачи 5 на том же локальном стенде, если после задачи 5 менялся код web; если менялась только документация — сослаться на результат задачи 5.
Run: `grep -rIn "Next\.js\|next-intl\|next build" --exclude-dir={node_modules,.git,.turbo,dist,analyst,superpowers} .` → только история: `docs/deployment/verification-2026-11-10.md`, строка 09.11 в handoff, `packages/contracts/src/catalog.ts` (комментарий; contracts вне объёма, поправить при следующей правке пакета), `infrastructure/keycloak/identity/README.md`.

- [ ] **Step 5: Commit** — `Документация: Web UI на Vite SPA и shadcn/ui Base UI в README, архитектуре и handoff`

---

## Связь с темой Keycloak (вне объёма этого плана)

`infrastructure/keycloak/identity` — уже Vite + React (Keycloakify), но на Radix `new-york`. Её план должен взять из этого:
- блок переменных `:root`/`.dark` — сейчас значения в `identity/src/styles.css` совпадают с `apps/web/src/app/globals.css`; после задачи 1 эталон — `apps/web/src/index.css`, расхождений быть не должно;
- шрифт `@fontsource-variable/inter`; логотип `apps/web/src/assets/imbc-logo.png` и правило подложки на светлом фоне; вид `AuthLayout` (шапка, левая колонка, подвал), чтобы экраны Keycloak и BFF выглядели одинаково;
- компоненты в варианте `base-nova`: `alert`, `button`, `card`, `checkbox`, `dropdown-menu`, `input`, `label`, `select`, `separator` (есть в теме сейчас), плюс `field` для подписей и ошибок;
- контракт cookie языка `NEXT_LOCALE` (имя, `Path=/`, `Max-Age=31536000`, `SameSite=Lax`, `Secure` на HTTPS).

## Что нельзя перенести один в один и что делаем

| В Next.js | В SPA |
|---|---|
| `/login` без ошибки — серверный 307 на `/api/auth/login` | Клиентский `location.replace` после загрузки SPA; на долю секунды виден индикатор «проверяем доступ» |
| Неизвестный адрес — HTTP 404 | HTTP 200 с `index.html` и переведённой страницей «не найдено» (новые ключи `notFound.*`); 404 остаётся для `/assets/*` |
| Смена языка — `router.refresh()`, сервер перерисовывает страницу | Переводы грузятся в браузере, язык меняется без перезагрузки; при недоступном файле — перезагрузка |
| `generateMetadata`, `<html lang>` с сервера | `<title>` React 19 и `document.documentElement.lang` при старте и смене языка |
| Иконка create-next-app (`favicon.ico`) | Удалена; иконки нет, пока IMBC не даст квадратный знак |
| Придуманный знак `BrandMark` (SVG «M») | Логотип IMBC; в свёрнутом сайдбаре знака нет |
| Размеры контролов `new-york` | Размеры `base-nova` (кнопки `h-8`, радиусы пресета) — следствие решения о пресете |

## Self-review

1. **Покрытие.** 11.1 — задачи 1–5; LANG-01 — `readLocale`/`localeCookie`, cookie без префикса, kk по умолчанию (задача 2); LANG-02 — эталон `en` в `messages.test.ts`; LANG-04 — тесты форматов (задачи 2, 4); LANG-05 — `logoAlt` не переводится; NFR-13 — Chrome в задаче 5, остальные браузеры — на стенде; NFR-14 — пункт 8 задачи 5; NFR-15 — переменные IMBC и логотип (задачи 1, 3, 4); OPR-05 — `catalog-params` и `catalog.test.tsx`; OPR-31 — вне объёма; маршруты и переходы — задачи 3, 4; Docker, CSP, кеш — задача 5; документы — задачи 5, 6. Roadmap обновляет владелец.
2. **Шаги.** У каждого тестового шага — имена и утверждения; у кодовых — файл, сигнатура, значения; тела страниц переносятся из указанных файлов `apps/web`, поэтому не повторяются.
3. **Имена.** `devProxy`, `readLocale`, `localeCookie`, `loadMessages`, `I18nProvider`, `useLocaleSwitch`, `leaveApp`, `reloadApp`, `Providers`, `PageTitle`, `routes`, `createAppRouter`, `renderRoute`, `stubApi`, `problem`, `resolveLoginState`, `LOGIN_ERRORS`, `Logo` — одинаковы во всех задачах.
4. **Review Focus.** Пять пунктов закреплены тестами задач 2, 3, 4 и проверками `curl` задачи 5.
5. **Пропорции.** Код в плане — только интерфейсы, тесты, конфигурация nginx/Docker и таблицы переводов; страницы переносятся из существующих файлов.
