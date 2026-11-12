import { computeBinCheckDigit } from "@imbc/contracts";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { leaveApp } from "@/lib/leave-app";
import type { Me } from "@/lib/session";

import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { type ApiReply, problem, stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

function me(gates: Me["gates"], role: Me["user"]["role"] = "operator", homePath = "/dashboard"): Me {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "operator@operator.local",
      fullName: "Оператор",
      role,
      organizationId: "00000000-0000-4000-8000-000000000002",
      organizationType: "operator",
      locale: "kk",
    },
    gates,
    homePath,
    otpDelivery: "email",
  };
}

/** Адреса, по которым прошёл роутер, — чтобы проверить переход, даже если следующая страница уведёт дальше. */
function visited(router: ReturnType<typeof renderRoute>["router"]): string[] {
  const paths: string[] = [];
  router.subscribe((state) => paths.push(`${state.location.pathname}${state.location.search}`));
  return paths;
}

const FIRST11 = "98054000038";
const BIN = `${FIRST11}${computeBinCheckDigit(FIRST11)}`;

const TERMS_PATH = "GET /api/v1/registrations/terms";
/** Текущая NDA из API (задача 3): номер версии и текст. */
const terms = (version = 1, body = "NDA body"): Record<string, ApiReply> => ({
  [TERMS_PATH]: { body: { nda: { version, body } } },
});
const ndaLabel = (messages: typeof kk, version = 1) =>
  messages.register.acceptNda.replace("{version}", String(version));
const readLabel = (messages: typeof kk, title: string) => messages.register.readDocument.replace("{title}", title);
/** Тексты элементов, на которые ссылается aria-describedby: подсказка и ошибка у поля. */
const describedBy = (element: HTMLElement) =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "");
const registrationPosts = (api: ReturnType<typeof stubApi>) =>
  api.mock.calls.filter(([url, init]) => String(url) === "/api/v1/registrations" && init?.method === "POST");

type Omitted = "platform" | "personal" | "nda" | "heard";
async function fillRegistration(
  user: ReturnType<typeof renderRoute>["user"],
  { email = "owner@company.local", skip, ndaVersion = 1 }: { email?: string; skip?: Omitted; ndaVersion?: number } = {},
) {
  await user.type(await screen.findByLabelText(kk.register.companyName), "ТОО Тест");
  await user.type(screen.getByLabelText(kk.register.bin), BIN);
  await user.type(screen.getByLabelText(kk.register.email), email);
  if (skip !== "heard") await user.type(screen.getByLabelText(kk.register.heardAboutUs), "Выставка");
  if (skip !== "platform") await user.click(screen.getByRole("checkbox", { name: kk.register.acceptPlatformTerms }));
  if (skip !== "personal") await user.click(screen.getByRole("checkbox", { name: kk.register.acceptPersonalData }));
  const nda = await screen.findByRole("checkbox", { name: ndaLabel(kk, ndaVersion) });
  if (skip !== "nda") await user.click(nda);
  await user.click(screen.getByRole("button", { name: kk.register.submit }));
}

const tooManyRequests = (seconds: number) => () =>
  Response.json(
    { type: "about:blank", title: "rate_limited", status: 429, code: "rate_limited" },
    { status: 429, headers: { "retry-after": String(seconds) } },
  );

describe("вход (ADR-04, AUTH-01)", () => {
  it("/login без ошибки уводит в BFF с returnTo и языком (ADR-04)", async () => {
    renderRoute("/login?returnTo=%2Fcatalog");

    await waitFor(() =>
      expect(leaveApp).toHaveBeenCalledWith("/api/auth/login?returnTo=%2Fcatalog&locale=kk", { replace: true }),
    );
    expect(leaveApp).toHaveBeenCalledTimes(1);
    // Пока браузер уходит в BFF — индикатор проверки, а не форма.
    expect(screen.getByText(kk.auth.checkingSession)).toBeTruthy();
  });

  it("/login?error=no_account: сообщение и вход другим адресом с prompt=login", async () => {
    const { router, user } = renderRoute("/login?error=no_account");

    expect((await screen.findByRole("alert")).textContent).toBe(kk.login.errors.no_account);
    expect(screen.getByRole("heading", { name: kk.login.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: kk.login.useAnotherEmail }).getAttribute("href")).toBe(
      "/api/auth/login?returnTo=%2F&locale=kk&prompt=login",
    );
    expect(screen.getByRole("link", { name: kk.login.forgotPassword }).getAttribute("href")).toBe(
      "/api/auth/password-reset?returnTo=%2F&locale=kk",
    );
    expect(document.title).toBe(`${kk.login.title} · ${kk.common.appName}`);
    // Логотип IMBC (NFR-15) один и декоративный: имя ссылки — название платформы на языке интерфейса.
    const home = screen.getByRole("link", { name: kk.common.appName });
    expect(home.getAttribute("href")).toBe("/login");
    expect(home.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(document.querySelectorAll('img[src*="imbc-logo"]')).toHaveLength(1);
    expect(screen.queryByRole("img", { name: kk.common.logoAlt })).toBeNull();

    await user.click(screen.getByRole("link", { name: kk.common.register }));
    expect(router.state.location.pathname).toBe("/register");
    expect(await screen.findByRole("heading", { name: kk.register.title })).toBeTruthy();
    expect(leaveApp).not.toHaveBeenCalled();
  });

  it("/login?logged_out=1 показывает «Вы вышли» (ru)", async () => {
    renderRoute("/login?logged_out=1&returnTo=%2Fdashboard", { locale: "ru" });

    expect(await screen.findByRole("heading", { name: ru.login.signedOutTitle })).toBeTruthy();
    expect(screen.getByText(ru.login.signedOutDescription)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: ru.login.signInAgain }).getAttribute("href")).toBe(
      "/api/auth/login?returnTo=%2Fdashboard&locale=ru&prompt=login",
    );
    expect(leaveApp).not.toHaveBeenCalled();
  });
});

describe("рамка экранов входа: две колонки (NFR-15, LANG-01)", () => {
  it("у экранов входа один логотип и нет видимого текста с названием платформы; ссылка логотипа названа по-прежнему (kk, ru, en)", async () => {
    for (const [locale, messages] of [
      ["kk", kk],
      ["ru", ru],
      ["en", en],
    ] as const) {
      renderRoute("/login?error=no_account", { locale });

      expect(await screen.findByRole("heading", { level: 1, name: messages.login.title })).toBeTruthy();
      const home = screen.getByRole("link", { name: messages.common.appName });
      expect(home.getAttribute("href")).toBe("/login");
      expect(home.textContent).toBe("");
      expect(document.querySelectorAll('img[src*="imbc-logo"]')).toHaveLength(1);
      // Название платформы — только имя ссылки; ни рядом с логотипом, ни подписью «IMBC» его нет.
      expect(screen.queryByText(messages.common.appName)).toBeNull();
      expect(screen.queryByText("IMBC")).toBeNull();
      // Пояснение под заголовком (в теме там бывает длинный адрес почты) переносится в любом месте и не шире колонки.
      const description = screen.getByText(messages.login.subtitle);
      expect(description.classList.contains("wrap-anywhere")).toBe(true);
      expect(description.classList.contains("max-w-full")).toBe(true);
      cleanup();
    }
  });

  it("панель реестра: заголовок, пояснение, строка о безопасности и строка подвала — в правой панели; на узком экране панель скрыта от программ чтения", async () => {
    renderRoute("/login?error=no_account", { locale: "ru" });

    const title = await screen.findByText(ru.authLayout.title);
    expect(title.tagName).not.toBe("H1");
    const panel = title.closest("aside");
    expect(panel).toBeTruthy();
    // Ориентир назван заголовком панели.
    expect(screen.getByRole("complementary", { name: ru.authLayout.title })).toBe(panel);
    for (const text of [ru.authLayout.description, ru.authLayout.security, ru.authLayout.footer]) {
      expect(panel?.contains(screen.getByText(text))).toBe(true);
    }
    // jsdom не раскладывает страницу: ниже lg панель скрыта display: none — и для программ чтения тоже.
    expect(panel?.classList.contains("hidden")).toBe(true);
    expect(panel?.classList.contains("lg:flex")).toBe(true);
    expect(panel?.querySelector("img")).toBeNull();
    // Подвала под страницей больше нет: его строка стоит в панели.
    expect(document.querySelector("footer")).toBeNull();
  });

  it("у каждого экрана (вход, регистрация, код, ответственность) один h1 и нет карточки с тенью", async () => {
    const screens: { path: string; title: string; api: Record<string, ApiReply> }[] = [
      { path: "/login?error=no_account", title: kk.login.title, api: {} },
      { path: "/register", title: kk.register.title, api: {} },
      {
        path: "/auth/verify",
        title: kk.verify.title,
        api: {
          "GET /api/auth/me": { body: me({ mfa: false, responsibility: false }) },
          "POST /api/auth/otp/send": { body: { sent: true, retryAfter: 60 } },
        },
      },
      {
        path: "/auth/responsibility",
        title: kk.responsibility.title,
        api: { "GET /api/auth/me": { body: me({ mfa: true, responsibility: false }) } },
      },
    ];
    for (const { path, title, api } of screens) {
      stubApi(api);
      renderRoute(path);

      const heading = await screen.findByRole("heading", { level: 1, name: title });
      expect(screen.getAllByRole("heading", { level: 1 }), path).toHaveLength(1);
      expect(heading.closest("main"), path).toBeTruthy();
      expect(document.querySelector('[data-slot="card"]'), path).toBeNull();
      expect(document.querySelector('[class*="shadow-lg"]'), path).toBeNull();
      cleanup();
    }
  });
});

describe("переходы по состоянию сеанса (AUTH-03, AUTH-10)", () => {
  it("/ без сеанса → /login; без второго фактора → /auth/verify?returnTo=…; без ответственности → /auth/responsibility?returnTo=…", async () => {
    stubApi({ "GET /api/auth/me": problem(401, "unauthorized") });
    let { router } = renderRoute("/");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("");
    await waitFor(() =>
      expect(leaveApp).toHaveBeenCalledWith("/api/auth/login?returnTo=%2F&locale=kk", { replace: true }),
    );
    cleanup();

    stubApi({
      "GET /api/auth/me": { body: me({ mfa: false, responsibility: false }) },
      "POST /api/auth/otp/send": { body: { sent: true, retryAfter: 60 } },
    });
    ({ router } = renderRoute("/"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/verify"));
    expect(router.state.location.search).toBe("?returnTo=%2Fdashboard");
    cleanup();

    stubApi({ "GET /api/auth/me": { body: me({ mfa: true, responsibility: false }) } });
    ({ router } = renderRoute("/"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/responsibility"));
    expect(router.state.location.search).toBe("?returnTo=%2Fdashboard");
  });

  it("/ при сбое связи показывает ошибку и повтор", async () => {
    stubApi({ "GET /api/auth/me": problem(503, "unavailable") });
    renderRoute("/");

    expect(await screen.findByText(kk.auth.connectionError)).toBeTruthy();
    expect(screen.getByRole("button", { name: kk.auth.retry })).toBeTruthy();
  });

  it("/auth/verify при истёкшем сеансе → /login?error=session_expired&returnTo=%2Fcatalog", async () => {
    stubApi({ "GET /api/auth/me": problem(401, "unauthorized") });
    const { router } = renderRoute("/auth/verify?returnTo=%2Fcatalog");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?error=session_expired&returnTo=%2Fcatalog");
    expect((await screen.findByRole("alert")).textContent).toBe(kk.login.errors.session_expired);
    expect(leaveApp).not.toHaveBeenCalled();
  });

  it("/auth/verify отправляет код один раз и подтверждает его (AUTH-03)", async () => {
    let verified = false;
    const api = stubApi({
      "GET /api/auth/me": () =>
        Response.json(verified ? me({ mfa: true, responsibility: false }) : me({ mfa: false, responsibility: false })),
      "POST /api/auth/otp/send": { body: { sent: true, retryAfter: 60 } },
      "POST /api/auth/otp/verify": () => {
        verified = true;
        return Response.json({ ok: true, responsibility: false });
      },
    });
    const { router, user } = renderRoute("/auth/verify?returnTo=https%3A%2F%2Fevil.example");

    expect(await screen.findByText(kk.verify.sent)).toBeTruthy();
    expect(screen.getByText("operator@operator.local")).toBeTruthy();
    const submit = screen.getByRole("button", { name: kk.verify.button });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByLabelText(kk.verify.codeLabel), "123456");
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await user.click(submit);

    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/responsibility"));
    // Чужой адрес возврата заменён стартовой страницей роли.
    expect(router.state.location.search).toBe("?returnTo=%2Fdashboard");
    const sends = api.mock.calls.filter(([url, init]) => String(url).endsWith("/otp/send") && init?.method === "POST");
    expect(sends).toHaveLength(1);
    const verify = api.mock.calls.find(([url]) => String(url).endsWith("/otp/verify"));
    expect(JSON.parse(String(verify?.[1]?.body))).toEqual({ code: "123456" });
  });

  it("/auth/verify: 401 на отправке кода → вход с session_expired и тем же returnTo", async () => {
    stubApi({
      "GET /api/auth/me": { body: me({ mfa: false, responsibility: false }) },
      "POST /api/auth/otp/send": problem(401, "unauthorized"),
    });
    const { router } = renderRoute("/auth/verify?returnTo=%2Fdashboard");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?error=session_expired&returnTo=%2Fdashboard");
    expect(leaveApp).not.toHaveBeenCalled();
  });

  it("/auth/verify: 401 на проверке кода → вход с session_expired и тем же returnTo", async () => {
    stubApi({
      "GET /api/auth/me": { body: me({ mfa: false, responsibility: false }) },
      "POST /api/auth/otp/send": { body: { sent: true, retryAfter: 60 } },
      "POST /api/auth/otp/verify": problem(401, "unauthorized"),
    });
    const { router, user } = renderRoute("/auth/verify?returnTo=%2Fdashboard");

    await user.type(await screen.findByLabelText(kk.verify.codeLabel), "123456");
    await user.click(screen.getByRole("button", { name: kk.verify.button }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?error=session_expired&returnTo=%2Fdashboard");
  });

  it("/auth/verify: 429 на повторной отправке запускает отсчёт и блокирует кнопку (AUTH-03)", async () => {
    let sends = 0;
    stubApi({
      "GET /api/auth/me": { body: me({ mfa: false, responsibility: false }) },
      // Первый код уже запрошен раньше, пауза истекла — повтор доступен сразу.
      "POST /api/auth/otp/send": () =>
        ++sends === 1 ? Response.json({ sent: false, reason: "too_soon", retryAfter: 0 }) : tooManyRequests(30)(),
    });
    const { user } = renderRoute("/auth/verify?returnTo=%2Fcatalog");

    expect(await screen.findByText(kk.verify.alreadyRequested)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: kk.verify.resend }));

    const countdown = await screen.findByRole("button", { name: kk.verify.resendIn.replace("{seconds}", "30") });
    expect((countdown as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe(kk.verify.tooSoon);
    expect(sends).toBe(2);
  });

  it("/auth/verify с пройденным вторым фактором и ответственностью → стартовая страница роли", async () => {
    stubApi({ "GET /api/auth/me": { body: me({ mfa: true, responsibility: true }) } });
    const { router } = renderRoute("/auth/verify?returnTo=/catalog");

    await waitFor(() => expect(router.state.location.pathname).toBe("/catalog"));
  });

  it("/auth/responsibility: принять → POST /api/auth/responsibility и переход на returnTo", async () => {
    let accepted = false;
    const api = stubApi({
      "GET /api/auth/me": () => Response.json(me({ mfa: true, responsibility: accepted })),
      "POST /api/auth/responsibility": () => {
        accepted = true;
        return new Response(null, { status: 204 });
      },
    });
    const { router, user } = renderRoute("/auth/responsibility?returnTo=%2Fdashboard");

    expect(await screen.findByRole("heading", { name: kk.responsibility.title })).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: kk.responsibility.accept }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(
      api.mock.calls.some(([url, init]) => String(url) === "/api/auth/responsibility" && init?.method === "POST"),
    ).toBe(true);
  });

  it("/auth/responsibility: 401 mfa_required при согласии → /auth/verify с тем же returnTo", async () => {
    stubApi({
      "GET /api/auth/me": { body: me({ mfa: true, responsibility: false }) },
      "POST /api/auth/responsibility": problem(401, "mfa_required"),
    });
    const { router, user } = renderRoute("/auth/responsibility?returnTo=%2Fdashboard");
    const paths = visited(router);

    await user.click(await screen.findByRole("button", { name: kk.responsibility.accept }));

    await waitFor(() => expect(paths[0]).toBe("/auth/verify?returnTo=%2Fdashboard"));
  });

  it("/auth/responsibility: после 401 mfa_required сеанс перечитывается, и /auth/verify не отправляет обратно", async () => {
    let mfaPassed = true;
    const api = stubApi({
      // Кеш /me (staleTime 60 с) ещё говорит, что второй фактор пройден; сервер уже требует код.
      "GET /api/auth/me": () => Response.json(me({ mfa: mfaPassed, responsibility: false })),
      "POST /api/auth/responsibility": () => {
        mfaPassed = false;
        return Response.json(
          { type: "about:blank", title: "mfa_required", status: 401, code: "mfa_required" },
          { status: 401 },
        );
      },
      "POST /api/auth/otp/send": { body: { sent: true, retryAfter: 60 } },
    });
    const { router, user } = renderRoute("/auth/responsibility?returnTo=%2Fdashboard");
    const meCalls = () => api.mock.calls.filter(([url]) => String(url) === "/api/auth/me").length;

    await user.click(await screen.findByRole("button", { name: kk.responsibility.accept }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/verify"));
    expect(router.state.location.search).toBe("?returnTo=%2Fdashboard");
    expect(meCalls()).toBe(2);
    expect(await screen.findByText(kk.verify.sent)).toBeTruthy();
    expect(router.state.location.pathname).toBe("/auth/verify");
  });

  it("/auth/responsibility: 401 истёкшего сеанса при согласии → /login?error=session_expired с тем же returnTo", async () => {
    stubApi({
      "GET /api/auth/me": { body: me({ mfa: true, responsibility: false }) },
      "POST /api/auth/responsibility": problem(401, "session_expired"),
    });
    const { router, user } = renderRoute("/auth/responsibility?returnTo=%2Fdashboard");

    await user.click(await screen.findByRole("button", { name: kk.responsibility.accept }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?error=session_expired&returnTo=%2Fdashboard");
    expect((await screen.findByRole("alert")).textContent).toBe(kk.login.errors.session_expired);
    expect(leaveApp).not.toHaveBeenCalled();
  });

  it("/auth/responsibility без второго фактора → /auth/verify с тем же returnTo", async () => {
    stubApi({
      "GET /api/auth/me": { body: me({ mfa: false, responsibility: false }) },
      "POST /api/auth/otp/send": { body: { sent: true, retryAfter: 60 } },
    });
    const { router } = renderRoute("/auth/responsibility?returnTo=%2Fdashboard");

    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/verify"));
    expect(router.state.location.search).toBe("?returnTo=%2Fdashboard");
  });
});

describe("регистрация производителя (MAN-01, MAN-02, FC-02, AUTH-01)", () => {
  it("галочка ставится кликом по подписи и пробелом", async () => {
    stubApi(terms());
    const { user } = renderRoute("/register");

    for (const name of [kk.register.acceptPlatformTerms, kk.register.acceptPersonalData, ndaLabel(kk)]) {
      const checkbox = await screen.findByRole("checkbox", { name });
      expect(checkbox.getAttribute("aria-checked"), name).toBe("false");

      await user.click(screen.getByText(name));
      expect(checkbox.getAttribute("aria-checked"), name).toBe("true");

      checkbox.focus();
      await user.keyboard(" ");
      expect(checkbox.getAttribute("aria-checked"), name).toBe("false");
    }
    expect(document.title).toBe(`${kk.register.title} · ${kk.common.appName}`);
  });

  it("три согласия и NDA с номером версии; без любой галочки или без ответа «Как вы узнали» форма не уходит, ошибка у поля (MAN-01)", async () => {
    const cases: { skip: Omitted; field: () => HTMLElement; error: string }[] = [
      {
        skip: "platform",
        field: () => screen.getByRole("checkbox", { name: kk.register.acceptPlatformTerms }),
        error: kk.register.errors.platform_terms_required,
      },
      {
        skip: "personal",
        field: () => screen.getByRole("checkbox", { name: kk.register.acceptPersonalData }),
        error: kk.register.errors.personal_data_required,
      },
      {
        skip: "nda",
        field: () => screen.getByRole("checkbox", { name: ndaLabel(kk, 4) }),
        error: kk.register.errors.nda_required,
      },
      {
        skip: "heard",
        field: () => screen.getByLabelText(kk.register.heardAboutUs),
        error: kk.register.errors.heard_about_us_required,
      },
    ];
    for (const { skip, field, error } of cases) {
      const api = stubApi(terms(4));
      const { user } = renderRoute("/register");

      expect(await screen.findByRole("checkbox", { name: ndaLabel(kk, 4) }), skip).toBeTruthy();
      expect(screen.getByText(kk.register.ndaHint), skip).toBeTruthy();
      // Ответ обязателен: подписи «(необязательно)» больше нет.
      expect(screen.getByText(kk.register.heardAboutUs).textContent, skip).toBe(kk.register.heardAboutUs);
      await fillRegistration(user, { skip, ndaVersion: 4 });

      expect(await screen.findByText(error), skip).toBeTruthy();
      expect(field().getAttribute("aria-invalid"), skip).toBe("true");
      expect(describedBy(field()), skip).toContain(error);
      expect(screen.getAllByRole("alert"), skip).toHaveLength(1);
      expect(registrationPosts(api), skip).toHaveLength(0);
      cleanup();
    }
  });

  it("тело запроса — ровно восемь полей, без acceptTerms и пароля, ndaVersion из API", async () => {
    const api = stubApi({
      ...terms(3),
      "POST /api/v1/registrations": { status: 202, body: { status: "password_email_queued" } },
    });
    const { user } = renderRoute("/register");

    await user.type(await screen.findByLabelText(kk.register.companyName), "  ТОО Тест ");
    await user.type(screen.getByLabelText(kk.register.bin), BIN);
    await user.type(screen.getByLabelText(kk.register.email), "owner@company.local");
    await user.type(screen.getByLabelText(kk.register.heardAboutUs), " Выставка ");
    await user.click(screen.getByRole("checkbox", { name: kk.register.acceptPlatformTerms }));
    await user.click(screen.getByRole("checkbox", { name: kk.register.acceptPersonalData }));
    await user.click(await screen.findByRole("checkbox", { name: ndaLabel(kk, 3) }));
    await user.click(screen.getByRole("button", { name: kk.register.submit }));

    expect(await screen.findByText(kk.register.successTitle)).toBeTruthy();
    const posts = registrationPosts(api);
    expect(posts).toHaveLength(1);
    const body = JSON.parse(String(posts[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toStrictEqual({
      companyName: "ТОО Тест",
      bin: BIN,
      email: "owner@company.local",
      heardAboutUs: "Выставка",
      acceptPlatformTerms: true,
      acceptPersonalData: true,
      ndaVersion: 3,
      locale: "kk",
    });
    expect(Object.keys(body)).toHaveLength(8);
    expect(body).not.toHaveProperty("acceptTerms");
    expect(body).not.toHaveProperty("password");
  });

  it("тексты: условия и политика — заглушки с отметкой «Заглушка», NDA — тело из API в диалоге; Escape закрывает диалог и возвращает фокус на кнопку", async () => {
    const ndaBody = "Первый абзац NDA.\n\nВторой абзац NDA.";
    stubApi(terms(1, ndaBody));
    const { user } = renderRoute("/register", { locale: "ru" });
    await screen.findByRole("checkbox", { name: ndaLabel(ru) });

    for (const { title, body } of [ru.legal.terms, ru.legal.privacy]) {
      const read = screen.getByRole("button", { name: readLabel(ru, title) });
      expect(read.textContent, title).toBe(ru.register.read);

      await user.click(read);
      const dialog = await screen.findByRole("dialog", { name: title });
      expect(within(dialog).getByText("Заглушка"), title).toBeTruthy();
      expect(within(dialog).getByText(body), title).toBeTruthy();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement, title).toBe(read));
    }

    const ndaTitle = ru.legal.nda.title.replace("{version}", "1");
    const read = screen.getByRole("button", { name: readLabel(ru, ndaTitle) });
    await user.click(read);
    const dialog = await screen.findByRole("dialog", { name: ndaTitle });
    expect(within(dialog).getByText(ru.legal.placeholder)).toBeTruthy();
    // Текст NDA — обычный текст с абзацами, не HTML.
    const text = within(dialog).getByText(/Первый абзац NDA/);
    expect(text.textContent).toBe(ndaBody);
    expect(text.classList.contains("whitespace-pre-line")).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: ru.legal.close }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(read));
    // Чтение текста галочку не ставит.
    expect(screen.getByRole("checkbox", { name: ndaLabel(ru) }).getAttribute("aria-checked")).toBe("false");
  });

  it("409 nda_version_changed — термины перечитаны (второй вызов заглушки), галочка NDA снята, сообщение", async () => {
    let termsCalls = 0;
    let posts = 0;
    const api = stubApi({
      [TERMS_PATH]: () => {
        termsCalls += 1;
        return Response.json({ nda: { version: termsCalls, body: "NDA body" } });
      },
      "POST /api/v1/registrations": () =>
        (posts += 1) === 1
          ? Response.json(
              { type: "about:blank", title: "nda_version_changed", status: 409, code: "nda_version_changed" },
              { status: 409 },
            )
          : Response.json({ status: "password_email_queued" }, { status: 202 }),
    });
    const { user } = renderRoute("/register");

    await fillRegistration(user);

    const nda = await screen.findByRole("checkbox", { name: ndaLabel(kk, 2) });
    expect(termsCalls).toBe(2);
    expect(nda.getAttribute("aria-checked")).toBe("false");
    expect(describedBy(nda)).toContain(kk.register.errors.nda_version_changed);
    await waitFor(() => expect(document.activeElement).toBe(nda));
    // Остальное, что человек ввёл и отметил, на месте.
    expect((screen.getByLabelText(kk.register.companyName) as HTMLInputElement).value).toBe("ТОО Тест");
    expect((screen.getByLabelText(kk.register.heardAboutUs) as HTMLInputElement).value).toBe("Выставка");
    for (const name of [kk.register.acceptPlatformTerms, kk.register.acceptPersonalData])
      expect(screen.getByRole("checkbox", { name }).getAttribute("aria-checked"), name).toBe("true");

    await user.click(nda);
    expect(screen.queryByText(kk.register.errors.nda_version_changed)).toBeNull();
    await user.click(screen.getByRole("button", { name: kk.register.submit }));

    expect(await screen.findByText(kk.register.successTitle)).toBeTruthy();
    const second = registrationPosts(api)[1];
    expect(JSON.parse(String(second?.[1]?.body))).toMatchObject({ ndaVersion: 2 });
  });

  it("terms 503 — «Регистрация временно недоступна», сбой сети — повтор; кнопка отправки недоступна", async () => {
    stubApi({ [TERMS_PATH]: problem(503, "nda_unavailable") });
    renderRoute("/register");

    expect(await screen.findByText(kk.register.ndaUnavailable)).toBeTruthy();
    const closed = screen.getByRole("button", { name: kk.register.submit }) as HTMLButtonElement;
    expect(closed.disabled).toBe(true);
    expect(describedBy(closed)).toContain(kk.register.ndaUnavailable);
    expect(screen.queryByRole("button", { name: kk.common.retry })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: ndaLabel(kk) })).toBeNull();
    cleanup();

    let offline = true;
    stubApi({
      [TERMS_PATH]: () => {
        if (offline) throw new TypeError("Failed to fetch");
        return Response.json({ nda: { version: 1, body: "NDA body" } });
      },
    });
    const { user } = renderRoute("/register");
    await user.type(await screen.findByLabelText(kk.register.companyName), "ТОО Тест");

    expect(await screen.findByText(kk.register.termsLoadError)).toBeTruthy();
    const submit = screen.getByRole("button", { name: kk.register.submit }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(describedBy(submit)).toContain(kk.register.termsLoadError);

    offline = false;
    await user.click(screen.getByRole("button", { name: kk.common.retry }));

    expect(await screen.findByRole("checkbox", { name: ndaLabel(kk) })).toBeTruthy();
    expect(screen.queryByText(kk.register.termsLoadError)).toBeNull();
    expect((screen.getByRole("button", { name: kk.register.submit }) as HTMLButtonElement).disabled).toBe(false);
    // Повтор загрузки не стирает введённое.
    expect((screen.getByLabelText(kk.register.companyName) as HTMLInputElement).value).toBe("ТОО Тест");
  });

  it("тексты на kk и en", async () => {
    for (const [locale, messages] of [
      ["kk", kk],
      ["en", en],
    ] as const) {
      stubApi(terms(2));
      renderRoute("/register", { locale });

      expect(await screen.findByRole("checkbox", { name: ndaLabel(messages, 2) }), locale).toBeTruthy();
      expect(screen.getByRole("checkbox", { name: messages.register.acceptPlatformTerms }), locale).toBeTruthy();
      expect(screen.getByRole("checkbox", { name: messages.register.acceptPersonalData }), locale).toBeTruthy();
      expect(screen.getByText(messages.register.ndaHint), locale).toBeTruthy();
      expect(screen.getByLabelText(messages.register.heardAboutUs), locale).toBeTruthy();
      for (const title of [
        messages.legal.terms.title,
        messages.legal.privacy.title,
        messages.legal.nda.title.replace("{version}", "2"),
      ])
        expect(screen.getByRole("button", { name: readLabel(messages, title) }), `${locale}: ${title}`).toBeTruthy();
      cleanup();
    }
  });

  it("регистрация отправляет форму с языком интерфейса и показывает ошибку БИН с сервера", async () => {
    const api = stubApi({ ...terms(), "POST /api/v1/registrations": problem(409, "bin_exists") });
    const { user } = renderRoute("/register");

    await fillRegistration(user);

    expect(await screen.findByText(kk.register.errors.bin_exists)).toBeTruthy();
    expect(screen.getByLabelText(kk.register.bin).getAttribute("aria-invalid")).toBe("true");
    const [, init] = registrationPosts(api)[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      companyName: "ТОО Тест",
      bin: BIN,
      email: "owner@company.local",
      heardAboutUs: "Выставка",
      acceptPlatformTerms: true,
      acceptPersonalData: true,
      ndaVersion: 1,
      locale: "kk",
    });
    // Неудачная отправка не стирает введённое и отмеченное.
    expect((screen.getByLabelText(kk.register.companyName) as HTMLInputElement).value).toBe("ТОО Тест");
    expect(screen.getByRole("checkbox", { name: ndaLabel(kk) }).getAttribute("aria-checked")).toBe("true");
  });

  it("без согласия и с неверным БИН форма не уходит на сервер", async () => {
    const api = stubApi(terms());
    const { user } = renderRoute("/register");

    await user.type(await screen.findByLabelText(kk.register.bin), "12345");
    await screen.findByRole("checkbox", { name: ndaLabel(kk) });
    await user.click(screen.getByRole("button", { name: kk.register.submit }));

    expect(screen.getByText(kk.register.errors.bin_format)).toBeTruthy();
    expect(screen.getByText(kk.register.errors.platform_terms_required)).toBeTruthy();
    expect(screen.getByText(kk.register.errors.personal_data_required)).toBeTruthy();
    expect(screen.getByText(kk.register.errors.nda_required)).toBeTruthy();
    expect(registrationPosts(api)).toHaveLength(0);
  });

  it("занятая почта: ошибка под полем и ссылка восстановления доступа в BFF", async () => {
    stubApi({ ...terms(), "POST /api/v1/registrations": problem(409, "email_exists") });
    const { user } = renderRoute("/register");

    await fillRegistration(user);

    expect(await screen.findByText(kk.register.errors.email_exists)).toBeTruthy();
    expect(screen.getByLabelText(kk.register.email).getAttribute("aria-invalid")).toBe("true");
    // Обычная ссылка: восстановление обслуживает BFF, а не роутер SPA.
    const recover = screen.getByRole("link", { name: kk.register.recoverAccount });
    expect(recover.tagName).toBe("A");
    expect(recover.getAttribute("href")).toBe("/api/auth/password-reset?returnTo=%2F&locale=kk");
  });

  it("429 на повторной отправке письма запускает отсчёт и блокирует кнопку", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = stubApi({
        ...terms(),
        "POST /api/v1/registrations": { status: 202, body: { status: "accepted" } },
        "POST /api/v1/registrations/resend": tooManyRequests(120),
      });
      const { user } = renderRoute("/register");

      await fillRegistration(user);
      expect(await screen.findByText(kk.register.successTitle)).toBeTruthy();
      // После заявки повтор доступен через минуту.
      const resendIn = (seconds: number) => kk.register.resendIn.replace("{seconds}", String(seconds));
      expect((screen.getByRole("button", { name: resendIn(60) }) as HTMLButtonElement).disabled).toBe(true);

      await vi.advanceTimersByTimeAsync(61_000);
      await user.click(await screen.findByRole("button", { name: kk.register.resend }));

      const countdown = await screen.findByRole("button", { name: resendIn(120) });
      expect((countdown as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByRole("alert").textContent).toBe(kk.register.rateLimited);
      const [, init] = api.mock.calls.find(([url]) => String(url) === "/api/v1/registrations/resend") ?? [];
      expect(JSON.parse(String(init?.body))).toEqual({ email: "owner@company.local" });
    } finally {
      vi.useRealTimers();
    }
  });
});
