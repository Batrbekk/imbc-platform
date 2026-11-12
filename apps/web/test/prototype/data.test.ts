// Демо-данные: те же двенадцать компаний, что в seed, ссылки между наборами целы, данные вымышленные.
import { isValidBin, PROFILE_STATUSES } from "@imbc/contracts";
import { describe, expect, it } from "vitest";

import { createInitialState } from "@/prototype/data";
import { ddResultOf } from "@/prototype/data/due-diligence";
import { isVisible, profileTier, tier3ProductIds, worksWithCount } from "@/prototype/rules";

const state = createInitialState();
const profileIds = new Set(state.profiles.map((p) => p.id));
const accountIds = new Set(state.accounts.map((a) => a.id));
const orgIds = new Set(state.organizations.map((o) => o.id));

describe("демо-данные прототипа", () => {
  it("двенадцать компаний seed с верными БИН", () => {
    expect(state.profiles).toHaveLength(12);
    for (const p of state.profiles) expect(isValidBin(p.bin), p.bin).toBe(true);
    expect(state.profiles.slice(0, 8).every((p) => p.status === "verified")).toBe(true);
    expect(state.profiles[0]).toMatchObject({ nameRu: "ТОО «Демо Металл Конструкция»", bin: "240100001001" });
  });

  it("статусы, итоги due diligence и тиры — все варианты", () => {
    for (const status of PROFILE_STATUSES)
      expect(
        state.profiles.some((p) => p.status === status),
        status,
      ).toBe(true);
    expect(state.profiles.some((p) => p.pendingChanges)).toBe(true);
    expect(new Set(state.dueDiligence.map((d) => d.result))).toEqual(new Set(["green", "amber", "red"]));
    const tiers = state.profiles.map((p) => profileTier(state, p));
    expect(tiers).toContain("tier_1");
    expect(tiers).toContain("tier_2");
    expect(tier3ProductIds(state, "p01")).toEqual(["p01-pl1"]);
    expect(state.tierRecords.map((r) => r.kind)).toEqual(expect.arrayContaining(["agar", "cdp"]));
  });

  it("у каждого профиля одна запись due diligence; итог по строкам считается по правилу IMBC-11", () => {
    for (const p of state.profiles)
      expect(
        state.dueDiligence.filter((d) => d.profileId === p.id),
        p.id,
      ).toHaveLength(1);
    for (const d of state.dueDiligence) expect(d.autoResult, d.profileId).toBe(ddResultOf(d.checks));
    // Red скрывает профиль от оператора и наблюдателя (раздел 4).
    expect(
      isVisible(
        state,
        state.profiles.find((p) => p.id === "p11")!,
      ),
    ).toBe(false);
  });

  it("ссылки между наборами указывают на существующие записи", () => {
    for (const a of state.accounts) expect(orgIds.has(a.organizationId), a.id).toBe(true);
    for (const p of state.profiles) {
      expect(orgIds.has(p.organizationId), p.id).toBe(true);
      if (p.assignedExpertId) expect(accountIds.has(p.assignedExpertId), p.id).toBe(true);
    }
    const byProfile = [
      ...state.dueDiligence,
      ...state.siteSurveys,
      ...state.siteSurveyRequests,
      ...state.tierRecords,
      ...state.imbcNotes,
      ...state.externalChecks,
      ...state.worksWithMarks,
      ...state.visitMarks,
      ...state.operatorNotes,
      ...state.operatorRequests,
      ...state.notifications,
    ];
    for (const r of byProfile) expect(profileIds.has(r.profileId), JSON.stringify(r).slice(0, 60)).toBe(true);
    for (const r of [...state.worksWithMarks, ...state.visitMarks, ...state.operatorNotes, ...state.imbcRequests]) {
      expect(orgIds.has(r.operatorOrgId)).toBe(true);
    }
    for (const r of state.imbcRequests) for (const m of r.messages) expect(accountIds.has(m.authorId), m.id).toBe(true);
    for (const r of state.operatorRequests) {
      expect(accountIds.has(r.senderId), r.id).toBe(true);
      if (r.reply) expect(accountIds.has(r.reply.authorId), r.id).toBe(true);
    }
    for (const r of state.tierRecords) {
      const profile = state.profiles.find((p) => p.id === r.profileId)!;
      expect(
        profile.sections.products.some((l) => l.id === r.productId),
        r.id,
      ).toBe(true);
    }
  });

  it("заметки операторов двух организаций; major operators — три (GEN-05, GEN-12)", () => {
    expect(new Set(state.operatorNotes.map((n) => n.operatorOrgId)).size).toBe(2);
    expect(state.organizations.filter((o) => o.majorOperator)).toHaveLength(3);
    expect(worksWithCount(state, "p01")).toBe(2);
  });

  it("ключи записей уникальны внутри набора", () => {
    for (const [name, value] of Object.entries(state)) {
      if (!Array.isArray(value) || !value.every((r) => typeof r === "object" && r && "id" in r)) continue;
      const ids = value.map((r: { id: string }) => r.id);
      expect(new Set(ids).size, name).toBe(ids.length);
    }
  });

  it("нет настоящих названий операторов и адресов вне демо-доменов", () => {
    const text = JSON.stringify(state);
    for (const name of ["NCOC", "TCO", "KPO", "Тенгиз", "Кашаган", "Карачаганак"]) expect(text).not.toContain(name);
    const emails = text.match(/[\w.+-]+@[\w.@-]+/g) ?? [];
    for (const email of emails) expect(email, email).toMatch(/\.local$/);
  });
});
