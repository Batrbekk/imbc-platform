import { computeBinCheckDigit } from "@imbc/contracts";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { leaveApp } from "@/lib/leave-app";
import type { Me } from "@/lib/session";

import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { problem, stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

function me(gates: Me["gates"], role: Me["user"]["role"] = "operator", homePath = "/catalog"): Me {
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

async function fillRegistration(user: ReturnType<typeof renderRoute>["user"], email = "owner@company.local") {
  await user.type(await screen.findByLabelText(kk.register.companyName), "ТОО Тест");
  await user.type(screen.getByLabelText(kk.register.bin), BIN);
  await user.type(screen.getByLabelText(kk.register.email), email);
  await user.click(screen.getByRole("checkbox", { name: kk.register.acceptTerms }));
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
    // Логотип IMBC (NFR-15) в шапке и в левой колонке декоративный: имя ссылки в шапке — название
    // платформы на языке интерфейса при любой ширине, в колонке название идёт текстом рядом.
    const home = screen.getByRole("link", { name: kk.common.appName });
    expect(home.getAttribute("href")).toBe("/login");
    expect(home.querySelector("img")?.getAttribute("alt")).toBe("");
    const logos = [...document.querySelectorAll<HTMLImageElement>('img[src*="imbc-logo"]')];
    expect(logos).toHaveLength(2);
    for (const logo of logos) expect(logo.getAttribute("alt")).toBe("");
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
    expect(router.state.location.search).toBe("?returnTo=%2Fcatalog");
    cleanup();

    stubApi({ "GET /api/auth/me": { body: me({ mfa: true, responsibility: false }) } });
    ({ router } = renderRoute("/"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/responsibility"));
    expect(router.state.location.search).toBe("?returnTo=%2Fcatalog");
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
    expect(router.state.location.search).toBe("?returnTo=%2Fcatalog");
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

describe("регистрация производителя (MAN-02, AUTH-01)", () => {
  it("согласие с условиями ставится кликом по подписи и пробелом (Review Focus 4)", async () => {
    const { user } = renderRoute("/register");

    const checkbox = await screen.findByRole("checkbox", { name: kk.register.acceptTerms });
    expect(checkbox.getAttribute("aria-checked")).toBe("false");

    await user.click(screen.getByText(kk.register.acceptTerms));
    expect(checkbox.getAttribute("aria-checked")).toBe("true");

    checkbox.focus();
    await user.keyboard(" ");
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(document.title).toBe(`${kk.register.title} · ${kk.common.appName}`);
  });

  it("регистрация отправляет форму с языком интерфейса и показывает ошибку БИН с сервера", async () => {
    const api = stubApi({ "POST /api/v1/registrations": problem(409, "bin_exists") });
    const { user } = renderRoute("/register");

    await fillRegistration(user);

    expect(await screen.findByText(kk.register.errors.bin_exists)).toBeTruthy();
    expect(screen.getByLabelText(kk.register.bin).getAttribute("aria-invalid")).toBe("true");
    const [, init] = api.mock.calls.find(([url]) => String(url) === "/api/v1/registrations") ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      companyName: "ТОО Тест",
      bin: BIN,
      email: "owner@company.local",
      acceptTerms: true,
      locale: "kk",
    });
  });

  it("без согласия и с неверным БИН форма не уходит на сервер", async () => {
    const api = stubApi({});
    const { user } = renderRoute("/register");

    await user.type(await screen.findByLabelText(kk.register.bin), "12345");
    await user.click(screen.getByRole("button", { name: kk.register.submit }));

    expect(screen.getByText(kk.register.errors.bin_format)).toBeTruthy();
    expect(screen.getByText(kk.register.errors.terms_required)).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });

  it("занятая почта: ошибка под полем и ссылка восстановления доступа в BFF", async () => {
    stubApi({ "POST /api/v1/registrations": problem(409, "email_exists") });
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
