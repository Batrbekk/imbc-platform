// Внешние проверки профиля: запуск всех коннекторов (имитация: Adata не вызывается, заглушки — тестовые данные),
// результаты рядом с записью due diligence (EXT-01, EXT-02, EXT-03, EXT-04).
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmAction, DueDiligenceBadge } from "@/prototype/components";
import type { ProtoProfile } from "@/prototype/data";
import { localized, useDictionary } from "@/prototype/i18n";
import { ddResult } from "@/prototype/rules";
import { nowIso, useProto, useProtoUpdate } from "@/prototype/store";

import { ExternalChecksTable } from "./dossier";
import { runExternalChecks } from "./simulate";
import { texts } from "./texts";

export function ChecksTab({ profile }: { profile: ProtoProfile }) {
  const t = useDictionary(texts);
  const update = useProtoUpdate();
  const state = useProto();
  const checks = state.externalChecks.filter((c) => c.profileId === profile.id);
  const dd = ddResult(state, profile.id);
  const run = () =>
    update(
      {
        action: "external_check.run",
        subject: { type: "external_check", id: profile.id, label: profile.nameRu },
        summary: localized(texts, "auditChecksRun"),
      },
      (draft) => runExternalChecks(draft, profile.id, nowIso()),
    );
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertDescription>{t("checksSimulated")}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>{t("checksDdResult")}</span>
        {dd && <DueDiligenceBadge result={dd} />}
        <ConfirmAction
          variant="outline"
          label={t("checksRun")}
          title={t("checksRunTitle")}
          description={t("checksRunDescription")}
          confirmLabel={t("checksRun")}
          onConfirm={run}
        />
      </div>
      <ExternalChecksTable checks={checks} />
    </div>
  );
}
