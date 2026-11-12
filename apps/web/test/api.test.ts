// Клиент BFF не берёт ответы из HTTP-кеша браузера: после выхода «Назад» не показывает
// данные прежнего пользователя, даже если заголовок Cache-Control потерялся по дороге (NFR-11).
import { describe, expect, it } from "vitest";

import { api } from "@/lib/api";

import { stubApi } from "./support/api";

describe("клиент BFF", () => {
  it("GET уходит с cache: 'no-store'", async () => {
    const fetch = stubApi({ "GET /api/auth/me": { body: { ok: true } } });
    await api("/auth/me");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ cache: "no-store" });
  });

  it("POST уходит с cache: 'no-store'", async () => {
    const fetch = stubApi({ "POST /api/auth/logout": { status: 204 } });
    await api("/auth/logout", { method: "POST", json: {} });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "POST", cache: "no-store" });
  });
});
