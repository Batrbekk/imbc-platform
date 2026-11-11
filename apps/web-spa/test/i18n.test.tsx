import type { Locale } from "@imbc/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import { useFormatter, useTranslations } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleSwitcher } from "@/components/app/locale-switcher";
import { loadMessages } from "@/i18n/messages";
import { I18nProvider } from "@/i18n/provider";
import { reloadApp } from "@/lib/leave-app";

import en from "../messages/en.json";
import ru from "../messages/ru.json";
import { renderRoute } from "./support/render";

// Настоящая загрузка переводов, которую отдельный тест заменяет отказом.
vi.mock("@/i18n/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/messages")>();
  return { ...actual, loadMessages: vi.fn(actual.loadMessages) };
});
vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

const INSTANT = new Date("2026-11-11T20:00:00Z");

function FormatProbe() {
  const format = useFormatter();
  return (
    <>
      <p data-testid="number">{format.number(1234567.5)}</p>
      <p data-testid="date">{format.dateTime(INSTANT, { dateStyle: "medium" })}</p>
    </>
  );
}

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

afterEach(() => {
  document.cookie = "NEXT_LOCALE=; Path=/; Max-Age=0";
  vi.clearAllMocks();
});

describe("языки интерфейса", () => {
  it("числа и даты следуют языку и часовому поясу Asia/Almaty (LANG-04)", () => {
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
      expect(screen.getByTestId("number").textContent).toBe(new Intl.NumberFormat(locale).format(1234567.5));
      expect(screen.getByTestId("date").textContent).toBe(
        new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Asia/Almaty" }).format(INSTANT),
      );
      if (locale === "en") expect(screen.getByTestId("date").textContent).toBe("Nov 12, 2026");
      unmount();
    }
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

  it("неизвестный адрес показывает страницу «не найдено» на языке пользователя", async () => {
    renderRoute("/no-such-page", { locale: "ru" });

    expect(await screen.findByRole("heading", { name: "Страница не найдена" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "На главную" }).getAttribute("href")).toBe("/");
    // Заголовок вкладки по шаблону Next: «%s · Платформа IMBC».
    expect(document.title).toBe("Страница не найдена · Платформа IMBC");
  });
});
