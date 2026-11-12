// Действия производителя над профилем, который открыт в кабинете: каждое меняет общее хранилище и
// пишет событие журнала (AUD-01). MAN-40, MAN-42…MAN-45, UPD-01, UPD-05, OPR-29, FC-03, IMBC-20, IMBC-25.
import type { Locale, ProfileSection } from "@imbc/contracts";

import type { ProfileSections, ProtoProfile, ProtoState } from "../data";
import { ACCOUNT } from "../data/accounts";
import { localized, translate } from "../i18n";
import { commonTexts } from "../labels";
import { currentNda } from "../rules";
import { extOf, newId, nowIso, useActor, useProtoUpdate } from "../store";
import {
  changedPendingSections,
  currentSections,
  EMPTY_EXT,
  fileSlots,
  sameValue,
  historyKey,
  isLocked,
  type ManufacturerExt,
  readExt,
  sameFile,
  SECTIONS,
} from "./model";
import { type TextKey, texts } from "./texts";

const LOCALES: Locale[] = ["en", "ru", "kk"];

/** Фраза журнала с названием секции на языке каждой фразы. */
function withSection(key: TextKey, section: ProfileSection): Record<Locale, string> {
  return Object.fromEntries(
    LOCALES.map((l) => [l, translate(texts, l, key, { section: translate(commonTexts, l, `section.${section}`) })]),
  ) as Record<Locale, string>;
}

/** Свои данные кабинета в черновике; сохранённое значение другой формы заменяется пустым. */
function myExt(draft: ProtoState): ManufacturerExt {
  draft.ext.manufacturer = structuredClone(readExt(draft.ext.manufacturer));
  return extOf<ManufacturerExt>(draft, "manufacturer", () => structuredClone(EMPTY_EXT));
}

const find = (draft: ProtoState, id: string) => draft.profiles.find((p) => p.id === id)!;

export function useManufacturerActions(profile: ProtoProfile) {
  const update = useProtoUpdate();
  const actor = useActor();
  const subject = { type: "profile" as const, id: profile.id, label: profile.nameRu };

  /**
   * Сохранить секцию (MAN-40). Draft и Returned — значения профиля; Verified — ожидающая правка,
   * операторы видят прежние значения (MAN-45, REV-08). Заменённый файл уходит в историю (MAN-36).
   */
  const saveSection = <S extends ProfileSection>(section: S, value: ProfileSections[S]): boolean => {
    if (isLocked(profile)) return false;
    // Сохранение без изменений — не правка: ни записи, ни события журнала.
    if (sameValue(value, currentSections(profile)[section])) return false;
    update(
      {
        action: "section.save",
        subject: { type: "section", id: `${profile.id}:${section}`, label: profile.nameRu },
        summary: withSection("auditSave", section),
      },
      (draft) => {
        const p = find(draft, profile.id);
        const before = fileSlots(section, { ...p.sections, ...p.pending });
        const after = fileSlots(section, { ...p.sections, ...p.pending, [section]: value });
        const ext = myExt(draft);
        for (const [slot, old] of Object.entries(before)) {
          if (old && !sameFile(old, after[slot] ?? null)) {
            const key = historyKey(p.id, slot);
            ext.fileHistory[key] = [...(ext.fileHistory[key] ?? []), old];
          }
        }
        if (p.status === "verified") p.pending[section] = value;
        else p.sections[section] = value;
        // «Правили после последнего решения SME»: ставит только кабинет производителя, снимает SME.
        p.review[section].changed = true;
      },
    );
    return true;
  };

  /** «Отправить на проверку» с подтверждением достоверности (MAN-42); Draft или Returned → Submitted. */
  const submit = () =>
    update({ action: "profile.submit", subject, summary: localized(texts, "auditSubmit") }, (draft) => {
      const p = find(draft, profile.id);
      if (p.status !== "draft" && p.status !== "returned") return;
      p.status = "submitted";
      p.submittedAt = nowIso();
      // Новое решение нужно только по изменённым секциям; решения по нетронутым сохраняются,
      // `changed` остаётся для SME (MAN-44, NOT-29).
      for (const s of SECTIONS) {
        const r = p.review[s];
        if (r.changed) p.review[s] = { ...r, decision: null, comment: null, decidedBy: null, decidedAt: null };
      }
      for (const item of [...p.sections.certificates, ...p.sections.documents]) {
        if (item.status === "uploaded") item.status = "under_review";
      }
    });

  /** Разблокировать (MAN-43): из очереди IMBC в Draft, решения по нетронутым секциям сохраняются. */
  const unlock = () =>
    update({ action: "profile.unlock", subject, summary: localized(texts, "auditUnlock") }, (draft) => {
      const p = find(draft, profile.id);
      if (p.status === "submitted" || p.status === "under_review") p.status = "draft";
      else if (p.status === "verified") p.pendingChanges = false;
    });

  /** «Отправить изменения на проверку» (MAN-45): профиль остаётся Verified. */
  const sendChanges = () =>
    update({ action: "profile.send_changes", subject, summary: localized(texts, "auditSendChanges") }, (draft) => {
      const p = find(draft, profile.id);
      // Без правок после последнего решения SME отправлять нечего (MAN-45).
      if (p.status !== "verified" || changedPendingSections(p).length === 0) return;
      p.pendingChanges = true;
      for (const item of [...(p.pending.certificates ?? []), ...(p.pending.documents ?? [])]) {
        if (item.status === "uploaded") item.status = "under_review";
      }
    });

  /** Подтвердить актуальность одним действием: active или outdated → active (UPD-02, NOT-31). */
  const confirmCurrent = () =>
    update({ action: "profile.confirm_current", subject, summary: localized(texts, "auditConfirm") }, (draft) => {
      const p = find(draft, profile.id);
      p.updateStatus = "active";
      p.lastConfirmedAt = nowIso();
      delete myExt(draft).confirmations[p.id];
    });

  /** Unresponsive: подтверждение по секциям; последняя возвращает active (UPD-05). */
  const confirmSection = (section: ProfileSection) =>
    update(
      {
        action: "section.confirm_current",
        subject: { type: "section", id: `${profile.id}:${section}`, label: profile.nameRu },
        summary: withSection("auditConfirmSection", section),
      },
      (draft) => {
        const p = find(draft, profile.id);
        const ext = myExt(draft);
        const done = new Set(ext.confirmations[p.id] ?? []);
        done.add(section);
        if (SECTIONS.every((s) => done.has(s))) {
          p.updateStatus = "active";
          p.lastConfirmedAt = nowIso();
          delete ext.confirmations[p.id];
        } else {
          ext.confirmations[p.id] = SECTIONS.filter((s) => done.has(s));
        }
      },
    );

  /** Один ответ на запрос оператора (OPR-29): профиль не меняется. */
  const reply = (requestId: string, text: string) =>
    update(
      {
        action: "operator_request.reply",
        subject: { type: "operator_request", id: requestId, label: profile.nameRu },
        summary: localized(texts, "auditReply"),
      },
      (draft) => {
        const r = draft.operatorRequests.find((x) => x.id === requestId);
        if (!r || r.reply) return;
        // Автор — аккаунт открытого профиля; адрес и имя сеанса в данные не пишутся.
        const author =
          draft.accounts.find((a) => a.organizationId === profile.organizationId && a.role === "manufacturer")?.id ??
          actor.accountId ??
          ACCOUNT.manufacturer;
        r.reply = { text, at: nowIso(), authorId: author };
        r.status = "closed";
      },
    );

  /** Принять текущую версию NDA (FC-02, FC-03): время, версия, адрес. */
  const acceptNda = (state: ProtoState) => {
    const nda = currentNda(state);
    update(
      {
        action: "nda.accept",
        subject: { type: "nda", id: nda.id, label: profile.nameRu },
        summary: localized(texts, "auditNda", { version: nda.version }),
      },
      (draft) => {
        find(draft, profile.id).nda = { versionId: nda.id, at: nowIso(), ip: "10.20.0.250" };
      },
    );
  };

  /** Запрос AGAR на один продукт, у которого есть STR (IMBC-25): без письма, не начинает визит. */
  const requestAgar = (productId: string, productName: string) =>
    update(
      {
        action: "tier_record.request",
        subject: { type: "tier_record", id: productId, label: profile.nameRu },
        summary: localized(texts, "auditAgar", { product: productName }),
      },
      (draft) => {
        if (draft.tierRecords.some((r) => r.profileId === profile.id && r.productId === productId)) return;
        draft.tierRecords.push({
          id: newId("agar"),
          profileId: profile.id,
          productId,
          kind: "agar",
          status: "requested",
          report: null,
          comment: null,
          requestedByManufacturer: true,
          updatedAt: nowIso(),
          updatedBy: null,
        });
      },
    );

  /** Запрос site survey без продукта и без письма (IMBC-20). */
  const requestSurvey = () =>
    update(
      {
        action: "site_survey.request",
        subject: { type: "site_survey", id: profile.id, label: profile.nameRu },
        summary: localized(texts, "auditSurvey"),
      },
      (draft) => {
        if (draft.siteSurveyRequests.some((r) => r.profileId === profile.id && r.status === "open")) return;
        draft.siteSurveyRequests.push({
          id: newId("ssr"),
          profileId: profile.id,
          requestedAt: nowIso(),
          status: "open",
        });
      },
    );

  /** Отметить письмо прочитанным. */
  const markRead = (notificationId: string) =>
    update(
      {
        action: "notification.read",
        subject: { type: "notification", id: notificationId, label: profile.nameRu },
        summary: localized(texts, "auditRead"),
      },
      (draft) => {
        const n = draft.notifications.find((x) => x.id === notificationId);
        if (n) n.read = true;
      },
    );

  return {
    saveSection,
    submit,
    unlock,
    sendChanges,
    confirmCurrent,
    confirmSection,
    reply,
    acceptNda,
    requestAgar,
    requestSurvey,
    markRead,
  };
}
