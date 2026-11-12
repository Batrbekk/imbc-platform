// Все профили для генерального директора IMBC (GEN-04, раздел 4: «all profiles»): статус, итог due diligence
// (IMBC-11), тир (IMBC-19, IMBC-20, IMBC-21), актуальность (UPD-06), видимость операторам, works-with (IMBC-16).
// Фильтры — в адресе; выгрузка CSV по DATA-10 без итога due diligence и операторов (DATA-13). Ничего не меняет.
import { PROFILE_STATUSES, UPDATE_STATUSES } from "@imbc/contracts";
import { DownloadIcon } from "lucide-react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { DueDiligenceBadge, ProfileStatusBadge, ProtoPage, TierBadge, UpdateStatusBadge } from "@/prototype/components";
import { useDictionary, useProtoLocale } from "@/prototype/i18n";
import { useCommonTexts } from "@/prototype/labels";
import { accountName, ddResult, isVisible, profileTier, tier3ProductIds, worksWithCount } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import { FilterSelect } from "./filter-select";
import { ALL, dossierPath, pick, useAddress } from "./paths";
import { csvFileName, downloadCsv, profilesCsv } from "./profiles-csv";
import { texts } from "./texts";

const STATUS_FILTERS = [ALL, ...PROFILE_STATUSES, "pending_changes"] as const;
const DD_FILTERS = [ALL, "green", "amber", "red", "none"] as const;
const TIER_FILTERS = [ALL, "tier_1", "tier_2", "none"] as const;
const UPDATE_FILTERS = [ALL, ...UPDATE_STATUSES] as const;
const VISIBLE_FILTERS = [ALL, "yes", "no"] as const;
const FILTER_KEYS = ["q", "status", "dd", "tier", "update", "visible"] as const;

export function ProfilesScreen() {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const format = useFormat();
  const state = useProto();
  const locale = useProtoLocale();
  const { params, set, clear } = useAddress();

  const query = params.get("q") ?? "";
  const status = pick(STATUS_FILTERS, params.get("status"), ALL);
  const dd = pick(DD_FILTERS, params.get("dd"), ALL);
  const tier = pick(TIER_FILTERS, params.get("tier"), ALL);
  const update = pick(UPDATE_FILTERS, params.get("update"), ALL);
  const visible = pick(VISIBLE_FILTERS, params.get("visible"), ALL);

  const rows = state.profiles.filter((p) => {
    const q = query.trim().toLowerCase();
    if (q && !p.nameRu.toLowerCase().includes(q) && !p.nameEn.toLowerCase().includes(q) && !p.bin.includes(q))
      return false;
    if (status === "pending_changes" ? !p.pendingChanges : status !== ALL && p.status !== status) return false;
    const result = ddResult(state, p.id);
    if (dd !== ALL && (dd === "none" ? result !== null : result !== dd)) return false;
    const profileTierValue = profileTier(state, p);
    if (tier !== ALL && (tier === "none" ? profileTierValue !== null : profileTierValue !== tier)) return false;
    if (update !== ALL && p.updateStatus !== update) return false;
    if (visible !== ALL && isVisible(state, p) !== (visible === "yes")) return false;
    return true;
  });
  const filtered = FILTER_KEYS.some((key) => params.has(key));

  const all = t("filterAll");
  const statusItems = STATUS_FILTERS.map((value) => ({
    value,
    label:
      value === ALL ? all : value === "pending_changes" ? common("pendingChanges") : common(`profileStatus.${value}`),
  }));
  const ddItems = DD_FILTERS.map((value) => ({
    value,
    label: value === ALL ? all : value === "none" ? t("ddNone") : common(`dd.${value}`),
  }));
  const tierItems = TIER_FILTERS.map((value) => ({
    value,
    label: value === ALL ? all : value === "none" ? common("noTier") : common(`tier.${value}`),
  }));
  const updateItems = UPDATE_FILTERS.map((value) => ({
    value,
    label: value === ALL ? all : common(`updateStatus.${value}`),
  }));
  const visibleItems = VISIBLE_FILTERS.map((value) => ({ value, label: value === ALL ? all : t(value) }));

  const exportCsv = () => downloadCsv(csvFileName(), profilesCsv(state, rows, locale));
  const majors = state.organizations.filter((o) => o.majorOperator).length;

  return (
    <ProtoPage
      hideReset
      title={t("profilesTitle")}
      description={
        <>
          <p>{t("profilesHint")}</p>
          <p>{t("readOnly")}</p>
        </>
      }
      actions={
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <DownloadIcon aria-hidden />
          {t("exportCsv")}
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-full sm:w-64"
          aria-label={t("search")}
          placeholder={t("search")}
          value={query}
          onChange={(e) => set("q", e.target.value)}
        />
        <FilterSelect label={t("statusFilter")} value={status} items={statusItems} onChange={(v) => set("status", v)} />
        <FilterSelect label={t("ddFilter")} value={dd} items={ddItems} onChange={(v) => set("dd", v)} />
        <FilterSelect label={t("tierFilter")} value={tier} items={tierItems} onChange={(v) => set("tier", v)} />
        <FilterSelect label={t("updateFilter")} value={update} items={updateItems} onChange={(v) => set("update", v)} />
        <FilterSelect
          label={t("visibleFilter")}
          value={visible}
          items={visibleItems}
          onChange={(v) => set("visible", v)}
        />
        {filtered && (
          <Button variant="ghost" onClick={() => clear(FILTER_KEYS)}>
            {t("clearFilters")}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        <span>{t("found", { count: format.number(rows.length), total: format.number(state.profiles.length) })}</span>
        <span className="text-xs">{t("exportHint")}</span>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("manufacturer")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("dueDiligence")}</TableHead>
              <TableHead>{t("tier")}</TableHead>
              <TableHead>{t("updateStatus")}</TableHead>
              <TableHead>{t("visibleToOperators")}</TableHead>
              <TableHead>{t("worksWith")}</TableHead>
              <TableHead>{t("assignedSme")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => {
              const result = ddResult(state, p.id);
              const tier3 = tier3ProductIds(state, p.id).length;
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link className="font-medium underline-offset-4 hover:underline" to={dossierPath(p.id)}>
                      {p.nameRu}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{p.bin}</div>
                  </TableCell>
                  <TableCell>
                    <ProfileStatusBadge status={p.status} pendingChanges={p.pendingChanges} />
                  </TableCell>
                  <TableCell>{result ? <DueDiligenceBadge result={result} /> : t("none")}</TableCell>
                  <TableCell>
                    <TierBadge tier={profileTier(state, p)} />
                    {tier3 > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {t("tier3Count", { count: format.number(tier3) })}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{p.updateStatus ? <UpdateStatusBadge status={p.updateStatus} /> : t("none")}</TableCell>
                  <TableCell>
                    {isVisible(state, p) ? (
                      <Badge variant="secondary">{t("visibleYes")}</Badge>
                    ) : (
                      <Badge variant="outline">
                        {p.status !== "verified" ? t("visibleNoStatus") : t("visibleNoRed")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {t("ofMajors", { count: format.number(worksWithCount(state, p.id)), total: format.number(majors) })}
                  </TableCell>
                  <TableCell className={p.assignedExpertId ? undefined : "text-muted-foreground"}>
                    {p.assignedExpertId ? accountName(state, p.assignedExpertId) : t("unassigned")}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {rows.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>{t("filterEmpty")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </ProtoPage>
  );
}
