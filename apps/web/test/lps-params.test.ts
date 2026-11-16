import { LPS_SORT_COLUMNS, lpsEntryWriteSchema } from "@imbc/contracts";
import { describe, expect, it } from "vitest";
import { lpsDraftInput, lpsEntryDraft, lpsTableAmount, reorderLps } from "@/features/lps/data";
import { changeLpsParams, lpsRequestParams, readLpsParams } from "@/features/lps/params";
import { LPS_ENTRY, lpsId } from "./support/lps";

describe("LPS address and exact business values", () => {
  it("copied repeated filters survive drilldown, paging and all eighteen typed sorts", () => {
    const current = new URLSearchParams({ q: "Demo", offset: "100", limit: "50", view: "dashboard", lastUpdatedFrom: "2026-01-01", lastUpdatedTo: "2026-12-31", unexpected: "drop" });
    for (const id of [lpsId(23), lpsId(28)]) current.append("commodityTypeIds", id);
    for (const city of ["Demo city", "Other demo city"]) current.append("cities", city);
    current.append("regionIds", lpsId(25));
    const next = changeLpsParams(current, { regionIds: ["unknown"], view: "table" });
    expect(next.getAll("commodityTypeIds")).toEqual(current.getAll("commodityTypeIds"));
    expect(next.getAll("cities")).toEqual(current.getAll("cities"));
    expect(next.has("offset")).toBe(false);
    for (const sort of LPS_SORT_COLUMNS) {
      const parsed = readLpsParams(changeLpsParams(next, { sort, direction: "desc" }), "ru");
      expect(parsed.success).toBe(true);
      if (!parsed.success) throw new Error("invalid fixture");
      const request = new URLSearchParams(lpsRequestParams(parsed.data));
      expect(request.getAll("regionIds")).toEqual(["unknown"]);
      expect(request.getAll("commodityTypeIds")).toHaveLength(2);
      expect(request.get("sort")).toBe(sort);
      expect(request.has("unexpected")).toBe(false);
      const dashboard = new URLSearchParams(lpsRequestParams(parsed.data, true));
      expect(dashboard.getAll("cities")).toEqual(request.getAll("cities"));
      expect(dashboard.has("sort")).toBe(false);
      expect(dashboard.has("offset")).toBe(false);
    }
    expect(readLpsParams(new URLSearchParams("sort=rawSQL"), "en").success).toBe(false);
    expect(readLpsParams(new URLSearchParams("lastUpdatedFrom=2026-12-31&lastUpdatedTo=2026-01-01"), "en").success).toBe(false);
  });
  it("display rounding never loses stored digits, nulls, period precision or contact associations", () => {
    expect(lpsTableAmount(LPS_ENTRY.investmentUsd)).toBe("9007199254740993.13");
    expect(lpsTableAmount("99.999")).toBe("100.00");
    expect(lpsTableAmount("0.0049")).toBe("0.00");
    expect(lpsTableAmount(null)).toBeNull();
    const draft = lpsEntryDraft(LPS_ENTRY);
    draft.contacts = reorderLps(draft.contacts, 1, -1);
    const write = lpsEntryWriteSchema.parse(lpsDraftInput(draft));
    expect(write.investmentUsd).toBe("9007199254740993.12500");
    expect(write.newJobs).toBeNull();
    expect(write.plannedLaunch).toBe("Q2 2028 / Q1 2029");
    expect(write.contacts[0]).toMatchObject({ id: lpsId(41), fullName: null, emails: ["general@lps.local"], phones: ["+70000000002 ext. 001"] });
    expect(write.locations.map((row) => row.regionId)).toEqual([lpsId(25), lpsId(25)]);
    expect(lpsEntryWriteSchema.safeParse(lpsDraftInput({ ...draft, newJobs: "1e3" })).success).toBe(false);
    expect(lpsEntryWriteSchema.safeParse(lpsDraftInput({ ...draft, investmentUsd: "1e3" })).success).toBe(false);
  });
});
