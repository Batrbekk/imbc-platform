import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ApiError } from "@/lib/api";
import { retryQuery } from "@/lib/query-client";

describe("повтор запросов клиента", () => {
  it("сбой сети и 5xx повторяются дважды; 4xx и 503 nda_unavailable — нет (FC-02)", () => {
    const network = new TypeError("Failed to fetch");
    const server = new ApiError(503, "unknown", "Service Unavailable");
    expect([0, 1, 2].map((count) => retryQuery(count, network))).toEqual([true, true, false]);
    expect([0, 1, 2].map((count) => retryQuery(count, server))).toEqual([true, true, false]);
    expect(retryQuery(0, new ApiError(404, "not_found", "Not Found"))).toBe(false);
    // NDA не опубликована — это ответ, а не сбой: повтор только тратит лимит маршрута.
    expect(retryQuery(0, new ApiError(503, "nda_unavailable", "Service Unavailable"))).toBe(false);
  });

  it("ответ неверной формы (ZodError) не повторяется: повтор его не исправит (FC-02)", () => {
    const parsed = z.object({ version: z.number() }).safeParse({});
    expect(parsed.success).toBe(false);
    expect(retryQuery(0, parsed.error)).toBe(false);
  });
});
