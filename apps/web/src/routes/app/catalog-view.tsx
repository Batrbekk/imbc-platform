import { COMMODITY_GROUPS, type CatalogPage } from "@imbc/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { CheckIcon, ChevronsUpDownIcon, LinkIcon, SearchIcon, XIcon } from "lucide-react";
import { createLoader, debounce, useQueryStates } from "nuqs";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";
import { catalogParsers, serializeCatalog } from "@/lib/catalog-params";

/** Фильтры из записанного адреса страницы — теми же парсерами, что у полей. */
const loadCatalog = createLoader(catalogParsers);

type Tri = "any" | "true" | "false";
const tri = (v: boolean | null): Tri => (v === null ? "any" : v ? "true" : "false");
const fromTri = (v: string): boolean | null => (v === "any" ? null : v === "true");

export function CatalogView() {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const format = useFormat();
  // Каждое изменение фильтра — новый адрес; history: push, чтобы «назад» возвращал прошлый поиск.
  // shallow: false — адаптер nuqs сообщает адрес и роутеру: иначе useLocation() в AppShell не видел бы
  // новых фильтров, и возврат после истёкшего сеанса потерял бы их.
  const [filters, setFilters] = useQueryStates(catalogParsers, { history: "push", shallow: false });
  // Поля показывают состояние nuqs сразу, а запрос строится из записанного адреса: ввод с задержкой
  // 350 мс даёт один запрос, и он совпадает с адресом, который вернёт returnTo (OPR-05).
  const { pathname, search } = useLocation();
  const query = serializeCatalog(loadCatalog(search));

  const result = useQuery({
    queryKey: ["catalog", query],
    queryFn: () => api<CatalogPage>(`/v1/catalog/search${query}`),
    placeholderData: keepPreviousData,
  });
  // Список регионов — из дашборда до появления справочника регионов (ADM-08).
  const regions = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<{ byRegion: { region: string; count: number }[] }>("/v1/dashboard"),
    select: (d) => d.byRegion.map((r) => r.region).sort(),
  });

  const set = (patch: Partial<typeof filters>) => setFilters({ ...patch, page: patch.page ?? 1 });
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (result.data?.pageSize ?? 25)));
  // То, что пользователь видит в фильтрах, включая текст, набранный меньше 350 мс назад.
  const shown = serializeCatalog(filters);
  const hasFilters = shown !== "";

  // Base UI показывает в SelectValue подпись из items, а не сырое значение из адреса.
  const triItems = [
    { value: "any", label: common("any") },
    { value: "true", label: common("yes") },
    { value: "false", label: common("no") },
  ];
  const sortItems = [
    { value: "name", label: t("sortName") },
    { value: "verified_at", label: t("sortVerified") },
    { value: "region", label: t("sortRegion") },
  ];

  const copyLink = async () => {
    try {
      // Адрес строит URL, как и сам браузер: абсолютный, не-ASCII символы закодированы (OPR-05).
      await navigator.clipboard.writeText(new URL(pathname + shown, window.location.origin).href);
      toast.success(t("linkCopied"));
    } catch {
      // Буфер обмена недоступен (нет разрешения, не HTTPS): сообщение вместо необработанной ошибки.
      toast.error(t("linkCopyFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-64 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          {/* Поля следуют адресу: «Сбросить» и «Назад» меняют и их текст (OPR-05). */}
          <Input
            className="pl-8"
            placeholder={t("query")}
            value={filters.q}
            onChange={(e) => setFilters({ q: e.target.value, page: 1 }, { limitUrlUpdates: debounce(350) })}
          />
        </div>

        <MultiPick
          label={t("region")}
          options={(regions.data ?? []).map((r) => ({ value: r, label: r }))}
          value={filters.region}
          onChange={(region) => set({ region })}
        />
        <MultiPick
          label={t("group")}
          options={COMMODITY_GROUPS.map((g) => ({ value: g, label: t("groupValue", { group: g }) }))}
          value={filters.group}
          onChange={(group) => set({ group: group as typeof filters.group })}
        />

        <Select
          items={triItems}
          value={tri(filters.surveyed)}
          onValueChange={(v) => v !== null && set({ surveyed: fromTri(v) })}
        >
          <SelectTrigger className="w-auto" aria-label={t("surveyed")}>
            <span className="text-muted-foreground">{t("surveyed")}:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {triItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={triItems}
          value={tri(filters.unifiedRegister)}
          onValueChange={(v) => v !== null && set({ unifiedRegister: fromTri(v) })}
        >
          <SelectTrigger className="w-auto" aria-label={t("unifiedRegister")}>
            <span className="text-muted-foreground">{t("unifiedRegister")}:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {triItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          className="w-40"
          inputMode="numeric"
          placeholder={t("tnved")}
          title={t("tnvedHint")}
          value={filters.tnved}
          onChange={(e) =>
            setFilters(
              { tnved: e.target.value.replace(/\D/g, "").slice(0, 10), page: 1 },
              { limitUrlUpdates: debounce(350) },
            )
          }
        />

        <Select
          items={sortItems}
          value={filters.sort}
          onValueChange={(v) => v !== null && set({ sort: v as typeof filters.sort })}
        >
          <SelectTrigger className="w-auto" aria-label={t("sort")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" onClick={() => setFilters(null)}>
            <XIcon />
            {common("reset")}
          </Button>
        )}
        <Button variant="outline" onClick={copyLink}>
          <LinkIcon />
          {t("copyLink")}
        </Button>
      </div>

      <div className="text-sm text-muted-foreground">
        {result.data && t("found", { count: total, total: format.number(total) })}
      </div>

      <div className={cn("rounded-lg border", result.isFetching && "opacity-70 transition-opacity")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.bin")}</TableHead>
              <TableHead>{t("columns.region")}</TableHead>
              <TableHead>{t("columns.groups")}</TableHead>
              <TableHead>{t("columns.certificates")}</TableHead>
              <TableHead>{t("columns.verifiedAt")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.isPending &&
              Array.from({ length: 6 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {result.data?.items.map((c) => (
              <TableRow key={c.profileId}>
                <TableCell>
                  <div className="font-medium">{c.nameRu}</div>
                  <div className="text-xs text-muted-foreground">{c.nameEn}</div>
                </TableCell>
                <TableCell className="font-mono text-xs">{c.bin}</TableCell>
                <TableCell>{c.region}</TableCell>
                <TableCell className="space-x-1">
                  {c.commodityGroups.map((g) => (
                    <Badge key={g} variant="secondary">
                      {g}
                    </Badge>
                  ))}
                </TableCell>
                <TableCell className="text-xs">{c.certificateTypes.join(", ") || "—"}</TableCell>
                <TableCell className="text-xs">{c.verifiedAt ? format.date(c.verifiedAt) : "—"}</TableCell>
                <TableCell>
                  <Badge variant={c.updateStatus === "active" ? "default" : "outline"}>
                    {t(`status.${c.updateStatus}`)}
                  </Badge>
                  {c.pendingChanges && <div className="mt-1 text-xs text-muted-foreground">{t("pending")}</div>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {result.data && result.data.items.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>{t("empty")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {result.isError && (
          <div className="flex items-center justify-between p-4 text-sm text-destructive">
            {common("error")}
            <Button size="sm" variant="outline" onClick={() => result.refetch()}>
              {common("retry")}
            </Button>
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">{t("page", { page: filters.page, pages })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page <= 1}
            onClick={() => set({ page: filters.page - 1 })}
          >
            {t("prev")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page >= pages}
            onClick={() => set({ page: filters.page + 1 })}
          >
            {t("next")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Множественный выбор внутри одного фильтра — OR (OPR-04). */
function MultiPick(props: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const toggle = (v: string) =>
    props.onChange(props.value.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" className="justify-between" />}>
        {props.label}
        {props.value.length > 0 && <Badge variant="secondary">{props.value.length}</Badge>}
        <ChevronsUpDownIcon className="opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={props.label} />
          <CommandList>
            <CommandEmpty>—</CommandEmpty>
            <CommandGroup>
              {props.options.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)}>
                  <CheckIcon className={cn(props.value.includes(o.value) ? "opacity-100" : "opacity-0")} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
