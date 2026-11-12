// Доступ к прогнозу и к STR/KTRE: только Verified с принятой текущей NDA (FC-01, FC-02, FC-03).
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { useFormat } from "@/i18n/format";

import type { ProtoProfile } from "../data";
import { useDictionary } from "../i18n";
import { currentNda, forecastOpen } from "../rules";
import { useProto } from "../store";
import { useManufacturerActions } from "./actions";
import { screenTexts } from "./screen-texts";

export function NdaGate({ profile, children }: { profile: ProtoProfile; children: ReactNode }) {
  const t = useDictionary(screenTexts);
  const format = useFormat();
  const state = useProto();
  const actions = useManufacturerActions(profile);
  const [accepted, setAccepted] = useState(false);
  if (profile.status !== "verified") {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyDescription>{t("gateNotVerified")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (forecastOpen(state, profile)) return <>{children}</>;
  const nda = currentNda(state);
  const previous = state.ndaVersions.find((v) => v.id === profile.nda?.versionId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("gateNdaTitle", { version: nda.version })}</CardTitle>
        <CardDescription>
          {previous
            ? t("gateNdaNew", { previous: previous.version, date: format.date(nda.publishedAt) })
            : t("gateNdaNone")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">{nda.summary}</p>
        <div className="flex items-start gap-2">
          <Checkbox id="manufacturer-nda" checked={accepted} onCheckedChange={(c) => setAccepted(c)} />
          <Label htmlFor="manufacturer-nda" className="leading-snug font-normal">
            {t("gateNdaAccept", { version: nda.version })}
          </Label>
        </div>
        <div>
          <Button disabled={!accepted} onClick={() => actions.acceptNda(state)}>
            {t("gateNdaButton")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
