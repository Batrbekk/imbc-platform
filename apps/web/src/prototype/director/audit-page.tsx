// Журнал аудита для генерального директора IMBC: все события всех ролей (AUD-01, AUD-03, GEN-04) — время,
// пользователь и роль, организация, что изменилось, объект; фильтры по пользователю, роли, организации, объекту,
// действию, названию объекта и периоду работают вместе и живут в адресе. Записи не меняются (AUD-02).
import { type Role, ROLES } from "@imbc/contracts";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { ProtoPage } from "@/prototype/components";
import type { AuditEvent } from "@/prototype/data";
import { useDictionary, useProtoLocale } from "@/prototype/i18n";
import { useCommonTexts } from "@/prototype/labels";
import { accountName, organizationName } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import { subjectProfileId } from "./audit-subject";
import { auditTexts } from "./audit-texts";
import { FilterSelect } from "./filter-select";
import { ALL, almatyDay, dossierPath, pick, useAddress } from "./paths";

const FILTER_KEYS = ["who", "role", "org", "object", "action", "q", "from", "to"] as const;
const TEXT_KEYS = new Set<string>(Object.keys(auditTexts.en));
type TextKey = keyof (typeof auditTexts)["en"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const distinct = <T,>(values: (T | null)[]): T[] => [...new Set(values.filter((v): v is T => v !== null))];

export function AuditScreen() {
  const t = useDictionary(auditTexts);
  const common = useCommonTexts();
  const format = useFormat();
  const locale = useProtoLocale();
  const state = useProto();
  const { params, set, clear } = useAddress();

  // Новые события — сверху; журнал общий для всех ролей этого браузера.
  const events = [...state.audit].reverse();
  const subjectLabel = (type: string) => (TEXT_KEYS.has(`subject.${type}`) ? t(`subject.${type}` as TextKey) : type);
  const roleLabel = (role: Role) => common(`role.${role}`);
  const actorName = (e: AuditEvent) =>
    e.actor.accountId ? accountName(state, e.actor.accountId) : roleLabel(e.actor.role);

  const accountIds = distinct(events.map((e) => e.actor.accountId));
  const orgIds = distinct(events.map((e) => e.actor.organizationId));
  const objectTypes = distinct(events.map((e) => e.subject.type));
  const actions = distinct(events.map((e) => e.action)).sort();

  const who = pick([ALL, ...accountIds], params.get("who"), ALL);
  const role = pick([ALL, ...ROLES], params.get("role"), ALL);
  const org = pick([ALL, ...orgIds], params.get("org"), ALL);
  const object = pick([ALL, ...objectTypes], params.get("object"), ALL);
  const action = pick([ALL, ...actions], params.get("action"), ALL);
  const query = params.get("q") ?? "";
  const from = ISO_DAY.test(params.get("from") ?? "") ? params.get("from")! : "";
  const to = ISO_DAY.test(params.get("to") ?? "") ? params.get("to")! : "";

  const shown = events.filter((e) => {
    if (who !== ALL && e.actor.accountId !== who) return false;
    if (role !== ALL && e.actor.role !== role) return false;
    if (org !== ALL && e.actor.organizationId !== org) return false;
    if (object !== ALL && e.subject.type !== object) return false;
    if (action !== ALL && e.action !== action) return false;
    const q = query.trim().toLowerCase();
    if (q && !e.subject.label.toLowerCase().includes(q) && !e.subject.id.toLowerCase().includes(q)) return false;
    const day = almatyDay(e.at);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
  const filtered = FILTER_KEYS.some((key) => params.has(key));

  const allLabel = t("all");
  const whoItems = [
    { value: ALL, label: allLabel },
    ...accountIds
      .map((id) => {
        const roleOf = events.find((e) => e.actor.accountId === id)!.actor.role;
        return { value: id, label: `${accountName(state, id)} · ${roleLabel(roleOf)}` };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const roleItems = [{ value: ALL, label: allLabel }, ...ROLES.map((r) => ({ value: r, label: roleLabel(r) }))];
  const orgItems = [
    { value: ALL, label: allLabel },
    ...orgIds
      .map((id) => ({ value: id, label: organizationName(state, id) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const objectItems = [
    { value: ALL, label: allLabel },
    ...objectTypes
      .map((type) => ({ value: type, label: subjectLabel(type) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  // Фраза события — подпись варианта, только если у всех событий кода она одна на этом языке
  // (у `profile.submit_result` она разная: Verified или Returned); иначе — нейтральная подпись кода или сам код.
  const actionLabel = (code: string) => {
    const phrases = new Set(events.filter((e) => e.action === code).map((e) => e.summary[locale] ?? e.summary.en));
    const label =
      phrases.size === 1 ? [...phrases][0]! : TEXT_KEYS.has(`action.${code}`) ? t(`action.${code}` as TextKey) : code;
    return label === code ? code : `${label} · ${code}`;
  };
  const actionItems = [
    { value: ALL, label: allLabel },
    ...actions
      .map((code) => ({ value: code, label: actionLabel(code) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  return (
    <ProtoPage hideReset title={t("title")} description={t("description")}>
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label={t("who")} value={who} items={whoItems} onChange={(v) => set("who", v)} />
        <FilterSelect label={t("role")} value={role} items={roleItems} onChange={(v) => set("role", v)} />
        <FilterSelect label={t("organization")} value={org} items={orgItems} onChange={(v) => set("org", v)} />
        <FilterSelect label={t("object")} value={object} items={objectItems} onChange={(v) => set("object", v)} />
        <FilterSelect label={t("action")} value={action} items={actionItems} onChange={(v) => set("action", v)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-full sm:w-64"
          aria-label={t("subjectSearch")}
          placeholder={t("subjectSearch")}
          value={query}
          onChange={(e) => set("q", e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("from")}
          <Input
            className="w-auto"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => set("from", e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("to")}
          <Input
            className="w-auto"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => set("to", e.target.value)}
          />
        </label>
        {filtered && (
          <Button variant="ghost" onClick={() => clear(FILTER_KEYS)}>
            {t("clearFilters")}
          </Button>
        )}
      </div>

      <div className="text-sm text-muted-foreground">
        {t("count", { count: format.number(shown.length), total: format.number(events.length) })}
      </div>

      {shown.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{events.length === 0 ? t("empty") : t("emptyFiltered")}</EmptyDescription>
          </EmptyHeader>
          {events.length > 0 && filtered && (
            <Button variant="outline" onClick={() => clear(FILTER_KEYS)}>
              {t("clearFilters")}
            </Button>
          )}
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("at")}</TableHead>
                <TableHead>{t("who")}</TableHead>
                <TableHead>{t("organization")}</TableHead>
                <TableHead>{t("what")}</TableHead>
                <TableHead>{t("object")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((e) => {
                const profileId = subjectProfileId(state, e);
                return (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs">{format.dateTime(e.at)}</TableCell>
                    {/* Автор — по ключу демо-аккаунта; почта и имя сеанса из события не показываются. */}
                    <TableCell className="whitespace-normal">
                      <div className="font-medium">{actorName(e)}</div>
                      <div className="text-xs text-muted-foreground">{roleLabel(e.actor.role)}</div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {organizationName(state, e.actor.organizationId)}
                    </TableCell>
                    <TableCell className="min-w-56 whitespace-normal">
                      <div>{e.summary[locale] ?? e.summary.en}</div>
                      <div className="font-mono text-xs text-muted-foreground">{e.action}</div>
                    </TableCell>
                    <TableCell className="min-w-48 whitespace-normal">
                      <div className="text-xs text-muted-foreground">{subjectLabel(e.subject.type)}</div>
                      {profileId ? (
                        <Link
                          className="break-words underline-offset-4 hover:underline"
                          aria-label={t("openProfile", { name: e.subject.label })}
                          to={dossierPath(profileId)}
                        >
                          {e.subject.label}
                        </Link>
                      ) : (
                        <span className="break-all">{e.subject.label}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </ProtoPage>
  );
}
