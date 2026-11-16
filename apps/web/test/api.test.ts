// Клиент BFF не берёт ответы из HTTP-кеша браузера: после выхода «Назад» не показывает
// данные прежнего пользователя, даже если заголовок Cache-Control потерялся по дороге (NFR-11).
import { describe, expect, it } from "vitest";

import { api, ApiError } from "@/lib/api";

import { stubApi } from "./support/api";

describe("клиент BFF", () => {
  it("GET уходит с cache: 'no-store'", async () => {
    const fetch = stubApi({ "GET /api/auth/me": { body: { ok: true } } });
    await api("/auth/me");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ cache: "no-store" });
  });

  it("parses scoped submission problems and drops malformed metadata", async () => {
    const id = "00000000-0000-4000-8000-000000000700";
    stubApi({
      "POST /api/test": {
        status: 400,
        body: {
          code: "profile_incomplete",
          title: "failure",
          missing: [
            { kind: "documents", path: "requiredTypes.0", code: "required" },
            { kind: "other", path: "x", code: "required" },
            null,
          ],
          requirements: [
            { kind: "documents", requiredTypeIds: [id] },
            { kind: "main_information", requiredTypeIds: [id] },
            { kind: "certificates", requiredTypeIds: ["not-a-uuid"] },
          ],
          errors: [{ path: "x", code: "required" }],
        },
      },
    });
    const error = await api("/test", { method: "POST" }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      submissionMissing: [{ kind: "documents", path: "requiredTypes.0", code: "required" }],
      submissionRequirements: [{ kind: "documents", requiredTypeIds: [id] }],
      fieldErrors: [{ path: "x", code: "required" }],
    });
  });

  it("POST уходит с cache: 'no-store'", async () => {
    const fetch = stubApi({ "POST /api/auth/logout": { status: 204 } });
    await api("/auth/logout", { method: "POST", json: {} });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "POST", cache: "no-store" });
  });
});
