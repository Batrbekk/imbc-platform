// Подписки на выгрузку (Release 2): сохранённый поиск, формат, период; пауза, возобновление, удаление,
// файлы за 90 дней. OPR-15, OPR-16, OPR-17, OPR-18, NOT-35, AUD-01, GEN-12.
import { useState } from "react";
import { useSearchParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";

import { ConfirmAction, ProtoPage } from "../components";
import type { ExportSubscription } from "../data";
import { localized, useDictionary } from "../i18n";
import { newId, nowIso, useProto, useProtoUpdate } from "../store";
import { ALL_COLUMNS, downloadFile } from "./export-file";
import { useBuildExport, useDescribeFilters, useOperator } from "./hooks";
import { Choice } from "./parts";
import { parseFilters, serializeFilters } from "./scope";
import { texts } from "./texts";

const PERIODS = ["daily", "weekly", "monthly"] as const;
const DAY = 86_400_000;

export function SubscriptionsScreen() {
  const t = useDictionary(texts);
  const state = useProto();
  const update = useProtoUpdate();
  const { organizationId, accountId } = useOperator();
  const describe = useDescribeFilters();
  const [params] = useSearchParams();
  // Сохранённый поиск приходит со страницы «Выгрузка» в адресе (OPR-15: подписка на текущий поиск).
  const filters = serializeFilters(parseFilters(params));
  const [name, setName] = useState("");
  const [fileFormat, setFileFormat] = useState<"xlsx" | "csv">("xlsx");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("weekly");
  // Подписки только свои (раздел 4: own only) и своей организации (GEN-12).
  const subscriptions = state.exportSubscriptions
    .filter((s) => s.operatorOrgId === organizationId && s.userId === accountId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Письмо — только на email своего аккаунта (OPR-16); адрес из демо-данных, не из сеанса.
  const email = state.accounts.find((a) => a.id === accountId)?.email ?? "—";

  const create = () => {
    const id = newId("sub");
    update(
      {
        action: "subscription.create",
        subject: { type: "subscription", id, label: name.trim() },
        summary: localized(texts, "auditSubCreate"),
      },
      (draft) => {
        draft.exportSubscriptions.push({
          id,
          operatorOrgId: organizationId,
          userId: accountId,
          name: name.trim(),
          filters,
          format: fileFormat,
          period,
          paused: false,
          createdAt: nowIso(),
          files: [],
        });
      },
    );
    setName("");
  };

  return (
    <ProtoPage title={t("subTitle")} release2 description={t("subHint", { email })}>
      <Card>
        <CardHeader>
          <CardTitle>{t("subNew")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("subSearch")}</span>
            <span>{describe(filters)}</span>
            <span className="text-muted-foreground">{t("subSearchHint")}</span>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sub-name">{t("subName")}</Label>
            <Input id="sub-name" className="sm:w-80" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Choice
              id="sub-format"
              label={t("format")}
              value={fileFormat}
              items={[
                { value: "xlsx", label: "XLSX" },
                { value: "csv", label: "CSV" },
              ]}
              onChange={(v) => setFileFormat(v === "csv" ? "csv" : "xlsx")}
            />
            <Choice
              id="sub-period"
              label={t("subPeriod")}
              value={period}
              items={PERIODS.map((p) => ({ value: p, label: t(`period.${p}`) }))}
              onChange={(v) => setPeriod(PERIODS.find((p) => p === v) ?? "weekly")}
            />
          </div>
          <div>
            <Button disabled={!name.trim()} onClick={create}>
              {t("subCreate")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">{t("inactiveHint")}</p>

      {subscriptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("subEmpty")}</p>
      ) : (
        subscriptions.map((s) => <SubscriptionCard key={s.id} subscription={s} />)
      )}
    </ProtoPage>
  );
}

function SubscriptionCard({ subscription: s }: { subscription: ExportSubscription }) {
  const t = useDictionary(texts);
  const format = useFormat();
  const update = useProtoUpdate();
  const describe = useDescribeFilters();
  const build = useBuildExport();
  const [since] = useState(() => Date.now() - 90 * DAY);
  const files = s.files.filter((f) => new Date(f.at).getTime() >= since).sort((a, b) => b.at.localeCompare(a.at));

  const togglePause = () =>
    update(
      {
        action: s.paused ? "subscription.resume" : "subscription.pause",
        subject: { type: "subscription", id: s.id, label: s.name },
        summary: localized(texts, s.paused ? "auditSubResume" : "auditSubPause"),
      },
      (draft) => {
        const target = draft.exportSubscriptions.find((x) => x.id === s.id);
        if (target) target.paused = !target.paused;
      },
    );
  const remove = () =>
    update(
      {
        action: "subscription.delete",
        subject: { type: "subscription", id: s.id, label: s.name },
        summary: localized(texts, "auditSubDelete"),
      },
      (draft) => {
        draft.exportSubscriptions = draft.exportSubscriptions.filter((x) => x.id !== s.id);
      },
    );
  const download = () => {
    const file = build(s.filters, ALL_COLUMNS, s.format);
    // Скачивание файла — событие журнала (AUD-01).
    update(
      {
        action: "subscription.download",
        subject: { type: "subscription", id: s.id, label: s.name },
        summary: localized(texts, "auditDownload", { name: file.name }),
      },
      () => {},
    );
    downloadFile(file.name, file.content, file.format);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {s.name}
          <Badge variant={s.paused ? "outline" : "secondary"}>{s.paused ? t("subPaused") : t("subActive")}</Badge>
        </CardTitle>
        <CardDescription>
          {describe(s.filters)} · {s.format.toUpperCase()} · {t(`period.${s.period}`)}
        </CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={togglePause}>
            {s.paused ? t("resume") : t("pause")}
          </Button>
          <ConfirmAction
            label={t("delete")}
            variant="destructive"
            size="sm"
            title={t("subDeleteTitle", { name: s.name })}
            confirmLabel={t("delete")}
            onConfirm={remove}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <span className="font-medium">{t("files")}</span>
        {files.length === 0 ? (
          <p className="text-muted-foreground">{t("filesEmpty")}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("hAt")}</TableHead>
                  <TableHead>{t("hRows")}</TableHead>
                  <TableHead />
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f) => (
                  <TableRow key={f.at}>
                    <TableCell className="text-xs">{format.dateTime(f.at)}</TableCell>
                    <TableCell>{format.number(f.rows)}</TableCell>
                    <TableCell>
                      <Badge variant={f.ok ? "secondary" : "destructive"}>{f.ok ? t("fileOk") : t("fileFailed")}</Badge>
                    </TableCell>
                    <TableCell>
                      {f.ok && (
                        <Button variant="ghost" size="sm" onClick={download}>
                          {t("download")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">{t("fileHint")}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
