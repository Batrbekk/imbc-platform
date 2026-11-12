// Версии NDA: ADM-10, FC-02, FC-03 (что публикация делает с доступом к прогнозу).
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ConfirmAction, ProtoPage } from "@/prototype/components";
import { localized, useDictionary } from "@/prototype/i18n";
import { accountName, currentNda } from "@/prototype/rules";
import { newId, nowIso, useProto, useProtoUpdate } from "@/prototype/store";

import { useAdminAccountId } from "./actor";
import { TextField } from "./fields";
import { ndaTexts } from "./nda-texts";
import { NdaVersionsView } from "./shared";

export function NdaScreen() {
  const t = useDictionary(ndaTexts);
  const state = useProto();
  return (
    <ProtoPage title={t("title")} description={t("description")} actions={<PublishNda />}>
      <Alert>
        <AlertTitle>{t("effectTitle")}</AlertTitle>
        <AlertDescription>{t("effect")}</AlertDescription>
      </Alert>
      <NdaVersionsView
        versions={state.ndaVersions}
        currentId={currentNda(state).id}
        accountName={(id) => accountName(state, id)}
      />
    </ProtoPage>
  );
}

function PublishNda() {
  const t = useDictionary(ndaTexts);
  const update = useProtoUpdate();
  const adminId = useAdminAccountId();
  const versions = useProto((s) => s.ndaVersions.map((v) => v.version));
  const [version, setVersion] = useState("");
  const [summary, setSummary] = useState("");
  const taken = versions.includes(version.trim());

  const publish = () => {
    const id = newId("nda");
    const number = version.trim();
    update(
      {
        action: "nda.publish",
        subject: { type: "nda", id, label: `NDA ${number}` },
        summary: localized(ndaTexts, "published", { version: number }),
      },
      (draft) => {
        draft.ndaVersions.push({
          id,
          version: number,
          publishedAt: nowIso(),
          publishedBy: adminId,
          summary: summary.trim(),
        });
      },
    );
    setVersion("");
    setSummary("");
  };

  return (
    <ConfirmAction
      label={t("publish")}
      title={t("publishTitle")}
      description={t("effect")}
      confirmLabel={t("publishConfirm")}
      confirmDisabled={!version.trim() || !summary.trim() || taken}
      onConfirm={publish}
    >
      <div className="flex flex-col gap-4">
        <TextField
          label={t("version")}
          value={version}
          onChange={setVersion}
          error={taken ? t("versionTaken") : null}
        />
        <TextField label={t("summary")} value={summary} onChange={setSummary} multiline />
      </div>
    </ConfirmAction>
  );
}
