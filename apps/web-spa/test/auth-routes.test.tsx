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
    // Логотип IMBC без перерисовки (NFR-15): в шапке и в левой колонке.
    expect(screen.getAllByRole("img", { name: kk.common.logoAlt }).length).toBeGreaterThan(0);

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
    const first11 = "98054000038";
    const bin = `${first11}${computeBinCheckDigit(first11)}`;
    const api = stubApi({ "POST /api/v1/registrations": problem(409, "bin_exists") });
    const { user } = renderRoute("/register");

    await user.type(await screen.findByLabelText(kk.register.companyName), "ТОО Тест");
    await user.type(screen.getByLabelText(kk.register.bin), bin);
    await user.type(screen.getByLabelText(kk.register.email), "owner@company.local");
    await user.click(screen.getByRole("checkbox", { name: kk.register.acceptTerms }));
    await user.click(screen.getByRole("button", { name: kk.register.submit }));

    expect(await screen.findByText(kk.register.errors.bin_exists)).toBeTruthy();
    expect(screen.getByLabelText(kk.register.bin).getAttribute("aria-invalid")).toBe("true");
    const [, init] = api.mock.calls.find(([url]) => String(url) === "/api/v1/registrations") ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      companyName: "ТОО Тест",
      bin,
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
});
