import type { Locale } from "@imbc/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useTranslations } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleSwitcher } from "@/components/app/locale-switcher";
import { Providers } from "@/components/app/providers";
import { useFormat } from "@/i18n/format";
import { loadMessages } from "@/i18n/messages";
import { I18nProvider, useLocaleSwitch } from "@/i18n/provider";
import { reloadApp } from "@/lib/leave-app";

import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { renderRoute } from "./support/render";

// Настоящая загрузка переводов, которую отдельный тест заменяет отказом.
vi.mock("@/i18n/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/messages")>();
  return { ...actual, loadMessages: vi.fn(actual.loadMessages) };
});
vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

// 19:30 UTC 14 октября — уже 15 октября в Алматы (UTC+5).
const INSTANT = new Date("2026-10-14T19:30:00Z");

function FormatProbe() {
  const format = useFormat();
  return (
    <>
      <p data-testid="number">{format.number(1234567.5)}</p>
      <p data-testid="date">{format.date(INSTANT)}</p>
      <p data-testid="dateTime">{format.dateTime(INSTANT)}</p>
    </>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

function SwitcherProbe() {
  const t = useTranslations("common");
  return (
    <>
      <LocaleSwitcher />
      <p>{t("appName")}</p>
    </>
  );
}

const probeRoutes = [{ path: "/catalog", element: <SwitcherProbe /> }];

/** Два переключения подряд, раньше чем загрузится первый файл. */
function RaceProbe() {
  const { change, pending } = useLocaleSwitch();
  const t = useTranslations("common");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void change("ru");
          void change("en");
        }}
      >
        switch
      </button>
      <p data-testid="pending">{String(pending)}</p>
      <p data-testid="name">{t("appName")}</p>
    </>
  );
}

afterEach(() => {
  document.cookie = "NEXT_LOCALE=; Path=/; Max-Age=0";
  vi.clearAllMocks();
});

describe("языки интерфейса", () => {
  it("ru и en: числа и даты по правилам языка в часовом поясе Asia/Almaty (LANG-04, DATA-08)", () => {
    const cases: [Locale, typeof en][] = [
      ["ru", ru],
      ["en", en],
    ];
    for (const [locale, messages] of cases) {
      const { unmount } = render(
        <I18nProvider initialLocale={locale} initialMessages={messages}>
          <FormatProbe />
        </I18nProvider>,
      );
      const zone = { timeZone: "Asia/Almaty" } as const;
      expect(text("number")).toBe(new Intl.NumberFormat(locale).format(1234567.5));
      expect(text("date")).toBe(new Intl.DateTimeFormat(locale, { dateStyle: "medium", ...zone }).format(INSTANT));
      expect(text("dateTime")).toBe(
        new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", ...zone }).format(INSTANT),
      );
      unmount();
    }
    render(
      <I18nProvider initialLocale="en" initialMessages={en}>
        <FormatProbe />
      </I18nProvider>,
    );
    expect(text("date")).toBe("Oct 15, 2026");
  });

  it("kk: дата dd.MM.yyyy, дата и время dd.MM.yyyy, HH:mm, число с пробелом и запятой (LANG-01, LANG-04)", () => {
    render(
      <I18nProvider initialLocale="kk" initialMessages={kk}>
        <FormatProbe />
      </I18nProvider>,
    );
    expect(text("date")).toBe("15.10.2026");
    expect(text("dateTime")).toBe("15.10.2026, 00:30");
    // Разделитель разрядов — пробел (какой именно, не важно), дробная часть — после запятой.
    expect(text("number")).toMatch(/^1\s234\s567,5$/);
  });

  it("переключатель меняет язык без перезагрузки и не трогает адрес (LANG-01, OPR-05)", async () => {
    const { router, user } = renderRoute("/catalog?q=steel", { routes: probeRoutes });
    expect(screen.getByText("IMBC платформасы")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Тіл" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Русский" }));

    expect(await screen.findByText("Платформа IMBC")).toBeTruthy();
    expect(document.cookie).toContain("NEXT_LOCALE=ru");
    expect(document.documentElement.lang).toBe("ru");
    expect(router.state.location.pathname).toBe("/catalog");
    expect(router.state.location.search).toBe("?q=steel");
    expect(reloadApp).not.toHaveBeenCalled();
  });

  it("если файл переводов не загрузился (вкладка старше выката), cookie записан и страница перезагружается", async () => {
    vi.mocked(loadMessages).mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"));
    const { user } = renderRoute("/catalog", { routes: probeRoutes });

    await user.click(screen.getByRole("button", { name: "Тіл" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "English" }));

    await waitFor(() => expect(reloadApp).toHaveBeenCalledTimes(1));
    expect(document.cookie).toContain("NEXT_LOCALE=en");
  });

  it("два переключения подряд — побеждает последний выбранный язык", async () => {
    let finishRu: (messages: typeof ru) => void = () => {};
    vi.mocked(loadMessages)
      .mockImplementationOnce(() => new Promise((resolve) => (finishRu = resolve)))
      .mockImplementationOnce(async () => en);
    render(
      <I18nProvider initialLocale="kk" initialMessages={kk}>
        <RaceProbe />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe(en.common.appName));
    expect(screen.getByTestId("pending").textContent).toBe("false");

    // Файл русского языка пришёл позже — он уже не нужен.
    finishRu(ru);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("name").textContent).toBe(en.common.appName);
    expect(document.documentElement.lang).toBe("en");
    expect(document.cookie).toContain("NEXT_LOCALE=en");
    expect(reloadApp).not.toHaveBeenCalled();
  });

  it("устаревший запрос языка, завершившийся отказом, не перезагружает страницу", async () => {
    let failRu: (error: Error) => void = () => {};
    vi.mocked(loadMessages)
      .mockImplementationOnce(() => new Promise((_, reject) => (failRu = reject)))
      .mockImplementationOnce(async () => en);
    render(
      <I18nProvider initialLocale="kk" initialMessages={kk}>
        <RaceProbe />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe(en.common.appName));
    failRu(new Error("Failed to fetch dynamically imported module"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reloadApp).not.toHaveBeenCalled();
    expect(screen.getByTestId("name").textContent).toBe(en.common.appName);
  });

  it("неизвестный адрес показывает страницу «не найдено» на языке пользователя", async () => {
    renderRoute("/no-such-page", { locale: "ru" });

    expect(await screen.findByRole("heading", { name: "Страница не найдена" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "На главную" }).getAttribute("href")).toBe("/");
    // Заголовок вкладки: «страница · название платформы».
    expect(document.title).toBe("Страница не найдена · Платформа IMBC");
  });

  it("область уведомлений названа на языке интерфейса", () => {
    for (const [locale, messages] of [
      ["kk", kk],
      ["ru", ru],
      ["en", en],
    ] as const) {
      const { unmount } = render(
        <Providers initialLocale={locale} initialMessages={messages}>
          <p>page</p>
        </Providers>,
      );
      const region = document.querySelector("section[aria-live]");
      expect(region?.getAttribute("aria-label"), locale).toMatch(new RegExp(`^${messages.common.notifications} `));
      unmount();
    }
  });
});
