// Выгрузка текущего поиска: колонки раздела 9.2, формат, файл из демо-данных, история своей организации.
// OPR-05, OPR-14, OPR-24, DATA-09, DATA-10, DATA-11, DATA-12, DATA-13, GEN-12.
import { COMMODITY_GROUPS, PROFILE_TIERS } from "@imbc/contracts";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";

import { ProtoPage, TierBadge } from "../components";
import { localized, useDictionary } from "../i18n";
import { useCommonTexts } from "../labels";
import { protoPath } from "../registry";
import { accountName, profileTier } from "../rules";
import { newId, nowIso, useProto, useProtoUpdate } from "../store";
import { ALL_COLUMNS, type Column, COLUMN_GROUPS, type ColumnGroup, downloadFile } from "./export-file";
import { type BuiltFile, useBuildExport, useDescribeFilters, useOperator } from "./hooks";
import { Choice } from "./parts";
import { ownOrg, parseFilters, searchProfiles, serializeFilters, visibleRegions } from "./scope";
import { texts } from "./texts";

const ALL = "all";

export function ExportScreen() {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const format = useFormat();
  const state = useProto();
  const update = useProtoUpdate();
  const { organizationId, accountId } = useOperator();
  const build = useBuildExport();
  const describe = useDescribeFilters();
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const filtersString = serializeFilters(filters);
  const results = searchProfiles(state, filters);
  const rowCount = results.reduce((n, p) => n + p.sections.products.length, 0);
  const [columns, setColumns] = useState<Set<Column>>(() => new Set(ALL_COLUMNS));
  const [fileFormat, setFileFormat] = useState<"xlsx" | "csv">("xlsx");
  const [built, setBuilt] = useState<BuiltFile | null>(null);
  const history = ownOrg(state.exportRecords, organizationId).sort((a, b) => b.at.localeCompare(a.at));

  // Фильтры — в адресе страницы (OPR-05); выбор колонок и формата — состояние экрана.
  const setFilter = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const toggle = (column: Column, on: boolean) =>
    setColumns((prev) => {
      const next = new Set(prev);
      if (on) next.add(column);
      else next.delete(column);
      return next;
    });
  const setGroup = (group: ColumnGroup, on: boolean) =>
    setColumns((prev) => {
      const next = new Set(prev);
      for (const c of COLUMN_GROUPS[group]) {
        if (on) next.add(c);
        else next.delete(c);
      }
      return next;
    });

  const run = () => {
    const ordered = ALL_COLUMNS.filter((c) => columns.has(c));
    const file = build(filtersString, ordered, fileFormat);
    const id = newId("exp");
    update(
      {
        action: "export.create",
        subject: { type: "export", id, label: file.name },
        summary: localized(texts, "auditExport", { format: fileFormat.toUpperCase(), rows: String(file.rows) }),
      },
      (draft) => {
        draft.exportRecords.push({
          id,
          operatorOrgId: organizationId,
          userId: accountId,
          at: nowIso(),
          format: fileFormat,
          rows: file.rows,
          filters: filtersString,
        });
      },
    );
    setBuilt(file);
    downloadFile(file.name, file.content, file.format);
  };

  const regions = visibleRegions(state);

  return (
    <ProtoPage title={t("expTitle")} description={t("expHint")}>
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="export-q">{t("search")}</Label>
            <Input
              id="export-q"
              className="sm:w-64"
              value={filters.q}
              onChange={(e) => setFilter("q", e.target.value.trim() ? e.target.value : null)}
            />
          </div>
          <Choice
            id="export-group"
            label={t("col.commodityGroup")}
            value={filters.group ?? ALL}
            items={[
              { value: ALL, label: t("groupAll") },
              ...COMMODITY_GROUPS.map((g) => ({ value: g, label: t("groupValue", { group: g }) })),
            ]}
            onChange={(v) => setFilter("group", v === ALL ? null : v)}
          />
          <Choice
            id="export-region"
            label={t("region")}
            value={filters.region ?? ALL}
            items={[{ value: ALL, label: t("regionAll") }, ...regions.map((r) => ({ value: r, label: r }))]}
            onChange={(v) => setFilter("region", v === ALL ? null : v)}
          />
          <Choice
            id="export-tier"
            label={t("tier")}
            value={filters.tier ?? ALL}
            items={[
              { value: ALL, label: t("tierAll") },
              ...PROFILE_TIERS.map((tier) => ({ value: tier, label: common(`tier.${tier}`) })),
            ]}
            onChange={(v) => setFilter("tier", v === ALL ? null : v)}
          />
          <div className="flex items-center gap-2 sm:h-8">
            <Switch
              id="export-surveyed"
              checked={filters.surveyed}
              onCheckedChange={(checked) => setFilter("surveyed", checked ? "true" : null)}
            />
            <Label htmlFor="export-surveyed">{t("surveyedOnly")}</Label>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("found", { count: format.number(results.length), rows: format.number(rowCount) })}
        </p>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colCompany")}</TableHead>
              <TableHead>{t("colRegion")}</TableHead>
              <TableHead>{t("col.commodityGroup")}</TableHead>
              <TableHead>{t("colTier")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium">{p.nameRu}</div>
                  <div className="font-mono text-xs text-muted-foreground">{p.bin}</div>
                </TableCell>
                <TableCell>{p.sections.main.region}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    {[...new Set(p.sections.products.map((l) => l.group))].map((g) => (
                      <Badge key={g} variant="secondary">
                        {t("groupValue", { group: g })}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell>
                  <TierBadge tier={profileTier(state, p)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {results.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>{t("resultsEmpty")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("columns")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(COLUMN_GROUPS) as ColumnGroup[]).map((group) => (
            <fieldset key={group} className="flex min-w-0 flex-col gap-2">
              <legend className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
                {t(`grp.${group}`)}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setGroup(group, true)}
                  aria-label={`${t(`grp.${group}`)}: ${t("selectAll")}`}
                >
                  {t("selectAll")}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setGroup(group, false)}
                  aria-label={`${t(`grp.${group}`)}: ${t("selectNone")}`}
                >
                  {t("selectNone")}
                </Button>
              </legend>
              {COLUMN_GROUPS[group].map((column) => (
                <Label key={column} className="font-normal">
                  <Checkbox checked={columns.has(column)} onCheckedChange={(checked) => toggle(column, checked)} />
                  {t(`col.${column}`)}
                </Label>
              ))}
            </fieldset>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-col gap-2">
          <span id="export-format" className="text-sm font-medium">
            {t("format")}
          </span>
          <RadioGroup
            aria-labelledby="export-format"
            className="flex gap-4"
            value={fileFormat}
            onValueChange={(value) => setFileFormat(value === "csv" ? "csv" : "xlsx")}
          >
            {(["xlsx", "csv"] as const).map((f) => (
              <Label key={f} className="font-normal">
                <RadioGroupItem value={f} />
                {f.toUpperCase()}
              </Label>
            ))}
          </RadioGroup>
        </div>
        {columns.size === 0 && <p className="text-sm text-destructive">{t("noColumns")}</p>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={columns.size === 0 || rowCount === 0} onClick={run}>
            {t("build")}
          </Button>
          <Link
            className={buttonVariants({ variant: "outline" })}
            to={`${protoPath("operator", "subscriptions")}${filtersString ? `?${filtersString}` : ""}`}
          >
            {t("subscribe")}
          </Link>
        </div>
        {built && (
          <p role="status" className="text-sm">
            {t("built", { name: built.name, rows: format.number(built.rows) })}
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("history")}</CardTitle>
          <CardDescription>{t("historyHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("hAt")}</TableHead>
                  <TableHead>{t("hUser")}</TableHead>
                  <TableHead>{t("hFormat")}</TableHead>
                  <TableHead>{t("hRows")}</TableHead>
                  <TableHead>{t("hSearch")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{format.dateTime(r.at)}</TableCell>
                    <TableCell>{accountName(state, r.userId)}</TableCell>
                    <TableCell>{r.format.toUpperCase()}</TableCell>
                    <TableCell>{format.number(r.rows)}</TableCell>
                    <TableCell>{describe(r.filters)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ProtoPage>
  );
}
