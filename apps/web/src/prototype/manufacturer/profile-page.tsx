// Профиль производителя: статус, полнота, что мешает отправке, секции и документы.
// MAN-41, MAN-42, MAN-43, MAN-44, MAN-45, MAN-46, MAN-35.
import { type ReactNode, useState } from "react";
import { Link } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";

import { ConfirmAction, DocumentStatusBadge, ProfileStatusBadge, UpdateStatusBadge } from "../components";
import type { ProtoProfile } from "../data";
import { useDictionary } from "../i18n";
import { useCommonTexts } from "../labels";
import { useProto } from "../store";
import { useManufacturerActions } from "./actions";
import { ManufacturerPage } from "./page";
import { MissingList, SectionStateBadge } from "./parts";
import {
  currentSections,
  isLocked,
  mandatoryTypes,
  sectionHref,
  pendingSections,
  profileCompleteness,
  SECTIONS,
  sectionState,
} from "./model";
import { texts, useDocumentLabel } from "./texts";
import { useViewedProfile, useWithViewAs } from "./view-as";

export function ProfilePage() {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const format = useFormat();
  const state = useProto();
  const { profile } = useViewedProfile();
  const withViewAs = useWithViewAs();
  const completeness = profileCompleteness(state, profile);
  const login = state.accounts.find((a) => a.organizationId === profile.organizationId && a.role === "manufacturer");

  return (
    <ManufacturerPage title={t("profileTitle")}>
      <Card>
        <CardHeader>
          <CardTitle>{profile.nameRu}</CardTitle>
          <CardDescription>{profile.nameEn}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Item label={t("bin")}>{profile.bin}</Item>
            <Item label={t("login")}>{login?.email ?? common("none")}</Item>
            <Item label={t("profileStatus")}>
              <ProfileStatusBadge status={profile.status} pendingChanges={profile.pendingChanges} />
            </Item>
            {profile.updateStatus && (
              <Item label={t("updateStatus")}>
                <UpdateStatusBadge status={profile.updateStatus} />
              </Item>
            )}
            {profile.submittedAt && <Item label={t("submittedAt")}>{format.dateTime(profile.submittedAt)}</Item>}
            {profile.verifiedAt && <Item label={t("verifiedAt")}>{format.date(profile.verifiedAt)}</Item>}
          </dl>
          <Progress value={completeness.percent} aria-label={t("completeness")} className="max-w-xl">
            <span className="text-sm font-medium">{t("completeness")}</span>
            <span className="ml-auto text-sm tabular-nums">
              {t("percent", { percent: format.number(completeness.percent) })}
            </span>
          </Progress>
          <StatusPanel profile={profile} percent={completeness.percent} />
        </CardContent>
      </Card>

      {completeness.percent < 100 && !isLocked(profile) && (
        <Card>
          <CardHeader>
            <CardTitle>{t("missingTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <MissingList bySection={completeness.bySection} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("sectionsTitle")}</CardTitle>
          <CardDescription>{t("sectionsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colSection")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colCompleteness")}</TableHead>
                <TableHead>{t("colComment")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SECTIONS.map((s) => {
                const c = completeness.bySection[s];
                const review = profile.review[s];
                return (
                  <TableRow key={s}>
                    <TableCell>
                      <Link className="font-medium underline-offset-4 hover:underline" to={withViewAs(sectionHref(s))}>
                        {common(`section.${s}`)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <SectionStateBadge state={sectionState(profile, s)} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {c.percent === null ? t("optional") : t("percent", { percent: format.number(c.percent) })}
                    </TableCell>
                    <TableCell className="max-w-sm text-sm whitespace-normal">
                      {review.decision === "rejected" && review.comment ? review.comment : common("none")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DocumentsCard profile={profile} />
    </ManufacturerPage>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/** Подсказка по статусу и действия: отправить, разблокировать, отправить изменения (MAN-42…MAN-45). */
function StatusPanel({ profile, percent }: { profile: ProtoProfile; percent: number }) {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const actions = useManufacturerActions(profile);
  const [accurate, setAccurate] = useState(false);
  const pending = pendingSections(profile);
  const verified = profile.status === "verified";

  const hint =
    verified && profile.pendingChanges
      ? t("hintPendingSent")
      : t(
          profile.status === "draft"
            ? "hintDraft"
            : profile.status === "submitted"
              ? "hintSubmitted"
              : profile.status === "under_review"
                ? "hintUnderReview"
                : profile.status === "returned"
                  ? "hintReturned"
                  : "hintVerified",
        );

  const accuracy = (
    <div className="flex items-start gap-2">
      <Checkbox id="manufacturer-accurate" checked={accurate} onCheckedChange={(c) => setAccurate(c)} />
      <Label htmlFor="manufacturer-accurate" className="leading-snug font-normal">
        {t("confirmAccurate")}
      </Label>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <Alert variant={profile.status === "returned" ? "destructive" : "default"}>
        <AlertDescription>{hint}</AlertDescription>
      </Alert>
      {verified && pending.length > 0 && (
        <p className="text-sm">
          {t("pendingList", { sections: pending.map((s) => common(`section.${s}`)).join(", ") })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {(profile.status === "draft" || profile.status === "returned") && (
          <>
            <ConfirmAction
              label={t("sendForReview")}
              title={t("sendTitle")}
              description={t("sendDescription")}
              confirmLabel={t("sendForReview")}
              disabled={percent < 100}
              confirmDisabled={!accurate}
              onConfirm={() => {
                actions.submit();
                setAccurate(false);
              }}
            >
              {accuracy}
            </ConfirmAction>
            {percent < 100 && <span className="text-sm text-muted-foreground">{t("sendBlocked")}</span>}
          </>
        )}
        {verified && !profile.pendingChanges && (
          <>
            <ConfirmAction
              label={t("sendChanges")}
              title={t("sendChangesTitle")}
              description={t("sendChangesDescription")}
              confirmLabel={t("sendChanges")}
              disabled={pending.length === 0 || percent < 100}
              confirmDisabled={!accurate}
              onConfirm={() => {
                actions.sendChanges();
                setAccurate(false);
              }}
            >
              {accuracy}
            </ConfirmAction>
            {pending.length === 0 && <span className="text-sm text-muted-foreground">{t("noPending")}</span>}
          </>
        )}
        {isLocked(profile) && (
          <ConfirmAction
            variant="outline"
            label={t("unlock")}
            title={t("unlockTitle")}
            description={verified ? t("unlockChangesDescription") : t("unlockDescription")}
            confirmLabel={t("unlock")}
            onConfirm={actions.unlock}
          />
        )}
      </div>
    </div>
  );
}

/** Статус каждого документа и сертификата (MAN-46); отсутствующий обязательный — missing. */
function DocumentsCard({ profile }: { profile: ProtoProfile }) {
  const t = useDictionary(texts);
  const state = useProto();
  const documentLabel = useDocumentLabel();
  const values = currentSections(profile);
  const certTypes = mandatoryTypes(state, "certificate_types");
  const missingCerts = certTypes.filter((type) => !values.certificates.some((c) => c.type === type && c.file));
  const docTypes = mandatoryTypes(state, "document_types");
  const rows = [
    ...values.certificates.map((c) => ({ key: c.id, label: c.type, status: c.status, comment: c.comment, note: null })),
    ...missingCerts.map((type) => ({
      key: `missing-${type}`,
      label: type,
      status: "missing" as const,
      comment: null,
      note: null,
    })),
    ...docTypes.map((type) => {
      const d = values.documents.find((x) => x.type === type);
      const present = d && (d.file || (type === "licence" && d.noLicenceRequired));
      return {
        key: `doc-${type}`,
        label: documentLabel(type),
        status: present ? d.status : ("missing" as const),
        comment: d?.comment ?? null,
        note: d?.noLicenceRequired && !d.file ? t("noLicenceStated") : null,
      };
    }),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("itemsTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="flex flex-col">
                <span className="font-medium">{r.label}</span>
                {r.note && <span className="text-muted-foreground">{r.note}</span>}
                {r.comment && <span className="text-destructive">{r.comment}</span>}
              </span>
              <DocumentStatusBadge status={r.status} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
