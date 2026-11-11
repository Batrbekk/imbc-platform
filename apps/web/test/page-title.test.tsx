// В документе один <title>: статичный из index.html до старта React и он же — с заголовком
// страницы после (HTML допускает один title; читатель DOM не должен видеть два).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PageTitle } from "@/components/app/page-title";

import type { Me } from "@/lib/session";

import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

// vitest запускается из каталога пакета (apps/web); <head> — из настоящего index.html.
const INDEX_HEAD = new DOMParser().parseFromString(
  readFileSync(resolve(process.cwd(), "index.html"), "utf8"),
  "text/html",
).head.innerHTML;

const titles = () => [...document.querySelectorAll("title")].map((title) => title.textContent);

beforeEach(() => {
  document.head.innerHTML = INDEX_HEAD;
});

afterEach(() => {
  document.head.innerHTML = "";
  vi.clearAllMocks();
});

const OPERATOR: Me = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "operator@operator.local",
    fullName: null,
    role: "operator",
    organizationId: "00000000-0000-4000-8000-000000000002",
    organizationType: "operator",
    locale: "kk",
  },
  gates: { mfa: true, responsibility: true },
  homePath: "/catalog",
  otpDelivery: "email",
};

describe("заголовок вкладки", () => {
  it("до старта React в index.html ровно один title", () => {
    expect(titles()).toEqual(["IMBC"]);
  });

  it("страница «не найдено»: один title с заголовком страницы", async () => {
    renderRoute("/no-such-page", { locale: "ru" });

    expect(await screen.findByRole("heading", { name: ru.notFound.title })).toBeTruthy();
    expect(titles()).toEqual([`${ru.notFound.title} · ${ru.common.appName}`]);
  });

  it("рабочая страница и переход на другую: всё время один title", async () => {
    stubApi({
      "GET /api/auth/me": { body: OPERATOR },
      "GET /api/v1/catalog/search": { body: { items: [], total: 0, page: 1, pageSize: 25 } },
      "GET /api/v1/dashboard": {
        body: {
          total: 0,
          byRegion: [],
          byCommodityGroup: [],
          siteSurveyed: 0,
          unifiedRegister: 0,
          updateStatus: { active: 0, outdated: 0, unresponsive: 0 },
          generatedAt: "2026-11-11T10:00:00Z",
        },
      },
    });
    const { router } = renderRoute("/catalog");

    expect(await screen.findByRole("heading", { name: kk.catalog.title })).toBeTruthy();
    expect(titles()).toEqual([`${kk.catalog.title} · ${kk.common.appName}`]);

    await router.navigate("/dashboard");
    expect(await screen.findByRole("heading", { name: kk.dashboard.title })).toBeTruthy();
    expect(titles()).toEqual([`${kk.dashboard.title} · ${kk.common.appName}`]);
  });

  it("страница без PageTitle после страницы с ним — название платформы, а не прежний заголовок", async () => {
    const { router } = renderRoute("/first", {
      routes: [
        {
          path: "/first",
          element: (
            <>
              <PageTitle title="Первая" />
              <h1>first</h1>
            </>
          ),
        },
        { path: "/second", element: <h1>second</h1> },
      ],
    });
    expect(await screen.findByRole("heading", { name: "first" })).toBeTruthy();
    expect(titles()).toEqual([`Первая · ${kk.common.appName}`]);

    await router.navigate("/second");
    expect(await screen.findByRole("heading", { name: "second" })).toBeTruthy();
    expect(titles()).toEqual([kk.common.appName]);
  });

  it("заголовок стоит уже до отрисовки кадра (layout effect), а не после", async () => {
    const seen: string[] = [];
    // Компонент после PageTitle читает заголовок в своём layout effect — до того, как браузер нарисует кадр.
    function Probe() {
      useLayoutEffect(() => {
        seen.push(document.title);
      }, []);
      return <h1>probe</h1>;
    }
    renderRoute("/probe", {
      routes: [
        {
          path: "/probe",
          element: (
            <>
              <PageTitle title="Новая" />
              <Probe />
            </>
          ),
        },
      ],
    });
    expect(await screen.findByRole("heading", { name: "probe" })).toBeTruthy();
    expect(seen[0]).toBe(`Новая · ${kk.common.appName}`);
  });
});
