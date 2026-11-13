import { can, DICTIONARY_CODES, DICTIONARY_ENTRY_STATUSES, type DictionaryEntriesPage } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { debounce, useQueryStates } from "nuqs";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { useLocation } from "react-router";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "@/components/ui/pagination";
import { Select, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNarrow } from "@/hooks/use-narrow";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";
import {
  entriesPath,
  hasMandatoryMark,
  isClosedDictionary,
  loadReferences,
  referencesParsers,
} from "@/lib/references-params";
import { useMe } from "@/lib/session";

import { ActionStatus } from "./action-status";
import { AnnounceContext, useActionStatus } from "./admin-actions";
import { FilterSelectContent } from "./filter-select";
import { OrgChartSampleCard } from "./org-chart-sample-card";
import { REFERENCES_KEY } from "./references-actions";
import { AddEntryDialog } from "./references-dialogs";
import { EntriesList, EntriesTable } from "./references-entries";

/** Карточка уже этого — значения идут списком вместо таблицы: на телефоне (390 px) и на узком окне с боковым меню. */
const TABLE_MIN_WIDTH = 640;

/** Строк скелета, пока список читается. */
const SKELETON_ROWS = 8;

/**
 * Справочники администратора IMBC и директора (ADM-08, ADM-09, ADM-11, DATA-03, DATA-04): двенадцать списков
 * с поиском и страницами, обязательность типов сертификатов и документов, вывод значений из оборота и образец
 * оргструктуры. Директор только читает: права решает сервер (GEN-08), интерфейс лишь не предлагает недоступное.
 * Состояние страницы живёт в адресе (`references-params.ts`).
 */
export function ReferencesPage() {
  const t = useTranslations("references");
  const me = useMe();
  const role = me.data?.user.role;
  const canManage = role !== undefined && can(role, "reference.manage") !== null;
  const { status, announce, dismiss } = useActionStatus();

  return (
    <AnnounceContext.Provider value={announce}>
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <PageTitle title={t("title")} />
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>

        <ActionStatus status={status} onDismiss={dismiss} dismissLabel={t("dismiss")} />

        <ReferenceListCard canManage={canManage} />
        <OrgChartSampleCard canManage={canManage} />
      </div>
    </AnnounceContext.Provider>
  );
}

/**
 * Карточка открытого справочника. Сверху — название крупно, пояснение и выбор справочника с видимой подписью;
 * под ними поиск, вкладки «Действующие / Выведенные / Все» и значения.
 */
function ReferenceListCard({ canManage }: { canManage: boolean }) {
  const t = useTranslations("references");
  const common = useTranslations("common");
  const format = useFormat();
  const card = useRef<HTMLDivElement>(null);
  // Заголовок карточки принимает фокус, когда строка, с которой работал человек, из списка пропала.
  const anchor = useRef<HTMLDivElement>(null);
  const compact = useNarrow(card, TABLE_MIN_WIDTH);
  const labelId = useId();
  const selectId = useId();

  // Каждое изменение — новый адрес (history: push): «Назад» возвращает прежний справочник, поиск, вкладку.
  // shallow: false — адаптер nuqs сообщает адрес и роутеру: возврат после истёкшего сеанса сохранит страницу.
  const [params, setParams] = useQueryStates(referencesParsers, { history: "push", shallow: false });
  // Поля ввода и выбор справочника показывают состояние nuqs сразу, а запрос строится из записанного адреса: ввод
  // с задержкой 350 мс даёт один запрос, и он совпадает с адресом, который вернёт returnTo. Всё, что описывает
  // показанные значения (название, подсказка, колонки, действия), берётся из того же адреса, что и значения:
  // между выбором справочника и записью адреса таблица не показывает строки прежнего справочника с колонками нового.
  const { search } = useLocation();
  const applied = loadReferences(search);
  const list = applied.list;
  const closed = isClosedDictionary(list);
  const mandatory = hasMandatoryMark(list);
  const listName = t(`list.${list}`);

  const entries = useQuery({
    queryKey: [...REFERENCES_KEY, "entries", applied.list, applied.q.trim(), applied.status, applied.page],
    queryFn: () => api<DictionaryEntriesPage>(entriesPath(applied)),
    // Поиск и страницы того же справочника не мигают скелетом: прежние значения остаются, пока приходят новые.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === applied.list ? previous : undefined),
  });
  const data = entries.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  // Страница за последней (последнее значение удалено): возвращаемся на последнюю, а не показываем пустоту.
  const lastPage = data && !entries.isPlaceholderData && data.items.length === 0 && data.total > 0 ? pages : null;
  useEffect(() => {
    if (lastPage !== null && applied.page > lastPage) void setParams({ page: lastPage }, { history: "replace" });
  }, [lastPage, applied.page, setParams]);

  const items = DICTIONARY_CODES.map((code) => ({ value: code, label: t(`list.${code}`) }));
  const count = (value: number | undefined) => (value === undefined ? "—" : format.number(value));

  // Справочник без значений: кнопка добавления — в самом сообщении «В справочнике пока нет значений», одна.
  const wholeListEmpty =
    data !== undefined &&
    data.total === 0 &&
    data.dictionary.active + data.dictionary.retired === 0 &&
    !applied.q.trim();

  const addButton = (
    <Button className={cn(compact && "w-full")}>
      <PlusIcon aria-hidden="true" />
      {t("add")}
    </Button>
  );

  return (
    <Card ref={card}>
      <CardHeader className={cn(compact && "has-data-[slot=card-action]:grid-cols-1")}>
        <CardTitle
          ref={anchor}
          role="heading"
          aria-level={2}
          tabIndex={-1}
          className="rounded-sm text-xl wrap-anywhere outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {listName}
        </CardTitle>
        {(closed || mandatory) && <CardDescription>{closed ? t("closedHint") : t("mandatoryHint")}</CardDescription>}
        <CardAction className={cn(compact && "col-start-1 row-span-1 row-start-auto mt-2 justify-self-stretch")}>
          <div className={cn("flex gap-2", compact ? "flex-col gap-3" : "items-end")}>
            <Field className="gap-1.5">
              <FieldLabel id={labelId} htmlFor={selectId}>
                {t("listLabel")}
              </FieldLabel>
              <Select
                items={items}
                value={params.list}
                onValueChange={(value) => {
                  const code = DICTIONARY_CODES.find((candidate) => candidate === value);
                  // Другой справочник — другой поиск, другая вкладка, первая страница.
                  if (code) void setParams({ list: code, q: null, status: null, page: null });
                }}
              >
                <SelectTrigger id={selectId} aria-labelledby={labelId} className={compact ? "w-full" : "w-64"}>
                  <SelectValue />
                </SelectTrigger>
                <FilterSelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </FilterSelectContent>
              </Select>
            </Field>
            {canManage && !closed && !wholeListEmpty && <AddEntryDialog dictionary={list} trigger={addButton} />}
          </div>
        </CardAction>
      </CardHeader>

      <CardContent>
        <Tabs
          value={params.status}
          onValueChange={(value) => {
            const next = DICTIONARY_ENTRY_STATUSES.find((candidate) => candidate === value);
            if (next) void setParams({ status: next, page: null });
          }}
        >
          <div className={cn("flex gap-3", compact ? "flex-col" : "flex-wrap items-center justify-between")}>
            <div role="search" className={cn(!compact && "w-full max-w-sm")}>
              <InputGroup>
                <InputGroupInput
                  type="text"
                  autoComplete="off"
                  aria-label={t("search")}
                  placeholder={t("search")}
                  value={params.q}
                  onChange={(event) =>
                    void setParams({ q: event.target.value, page: null }, { limitUrlUpdates: debounce(350) })
                  }
                />
                <InputGroupAddon>
                  <SearchIcon aria-hidden="true" />
                </InputGroupAddon>
                {params.q !== "" && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={t("clearSearch")}
                      onClick={() => void setParams({ q: null, page: null })}
                    >
                      <XIcon aria-hidden="true" />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </div>
            {/* Вкладки со счётчиками списка; не помещаются в строку — аккуратно переносятся. */}
            <TabsList
              aria-label={t("statusLabel")}
              className={cn("flex-wrap group-data-horizontal/tabs:h-auto", compact && "w-full")}
            >
              <TabsTrigger value="active" className={cn("h-7 flex-auto", compact ? "px-1.5" : "px-2.5")}>
                {t("status.active", { count: count(data?.dictionary.active) })}
              </TabsTrigger>
              <TabsTrigger value="retired" className={cn("h-7 flex-auto", compact ? "px-1.5" : "px-2.5")}>
                {t("status.retired", { count: count(data?.dictionary.retired) })}
              </TabsTrigger>
              <TabsTrigger value="all" className={cn("h-7 flex-auto", compact ? "px-1.5" : "px-2.5")}>
                {t("status.all")}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value={params.status} className="mt-1 flex flex-col gap-4">
            {entries.isError && !data ? (
              // Кнопка — под текстом, а не в AlertAction: у Alert для неё отведено 4,5rem справа, а «Повторить»
              // и «Қайталау» шире и на узком экране легли бы на текст.
              <Alert variant="destructive">
                <AlertDescription>{t("loadError")}</AlertDescription>
                <div className="mt-2">
                  <Button size="sm" variant="outline" onClick={() => void entries.refetch()}>
                    {common("retry")}
                  </Button>
                </div>
              </Alert>
            ) : !data ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                {/* Для программ чтения с экрана: серые полосы ничего не говорят. */}
                <span className="sr-only">{common("loading")}</span>
                {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : data.items.length === 0 ? (
              // Страница за последней — кратко: эффект выше возвращает на последнюю.
              data.total > 0 ? null : (
                <EmptyList
                  dictionary={data.dictionary}
                  q={applied.q.trim()}
                  status={applied.status}
                  addable={canManage && !closed}
                  addButton={
                    <AddEntryDialog dictionary={list} trigger={<Button>{t("add")}</Button>} fallbackFocus={anchor} />
                  }
                  onReset={() => void setParams({ q: null, page: null })}
                />
              )
            ) : (
              <>
                <div
                  className={cn(
                    "rounded-lg",
                    !compact && "border",
                    entries.isFetching && "opacity-60 transition-opacity",
                  )}
                >
                  {compact ? (
                    <EntriesList
                      items={data.items}
                      listName={listName}
                      dictionary={list}
                      canManage={canManage}
                      status={applied.status}
                      focusAnchor={anchor}
                    />
                  ) : (
                    <EntriesTable
                      items={data.items}
                      listName={listName}
                      dictionary={list}
                      canManage={canManage}
                      status={applied.status}
                      focusAnchor={anchor}
                    />
                  )}
                </div>
                {data.total > data.pageSize && (
                  <PageFooter
                    compact={compact}
                    page={data.page}
                    pages={pages}
                    from={(data.page - 1) * data.pageSize + 1}
                    to={Math.min(data.page * data.pageSize, data.total)}
                    total={data.total}
                    onPage={(page) => void setParams({ page: page === 1 ? null : page })}
                  />
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/**
 * Пусто: пустой поиск («Ничего не найдено» и «Сбросить поиск»), пустой справочник (у администратора — кнопка
 * «Добавить значение») или вкладка, на которой значений нет, с объяснением почему.
 */
function EmptyList({
  dictionary,
  q,
  status,
  addable,
  addButton,
  onReset,
}: {
  dictionary: DictionaryEntriesPage["dictionary"];
  q: string;
  status: "active" | "retired" | "all";
  addable: boolean;
  addButton: ReactNode;
  onReset: () => void;
}) {
  const t = useTranslations("references");
  const none = dictionary.active + dictionary.retired === 0;
  const message = q
    ? t("noResults", { q })
    : none || status === "all"
      ? t("empty")
      : status === "active"
        ? t("emptyActive")
        : t("emptyRetired");
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      {q ? (
        <EmptyContent>
          <Button variant="outline" onClick={onReset}>
            {t("resetSearch")}
          </Button>
        </EmptyContent>
      ) : (
        none && addable && <EmptyContent>{addButton}</EmptyContent>
      )}
    </Empty>
  );
}

/** Номера страниц: первая, последняя и соседи текущей; пропуск в одну страницу не прячется за многоточием. */
function pageItems(current: number, pages: number): (number | "gap-before" | "gap-after")[] {
  const shown = [...new Set([1, current - 1, current, current + 1, pages])]
    .filter((page) => page >= 1 && page <= pages)
    .sort((a, b) => a - b);
  const result: (number | "gap-before" | "gap-after")[] = [];
  shown.forEach((page, index) => {
    const previous = shown[index - 1];
    if (previous !== undefined && page - previous === 2) result.push(previous + 1);
    else if (previous !== undefined && page - previous > 2)
      result.push(index === shown.length - 1 ? "gap-after" : "gap-before");
    result.push(page);
  });
  return result;
}

/**
 * Подвал списка: «Показано {from}–{to} из {total}» и постраничный переход — кнопки, не ссылки: адрес меняет
 * nuqs без перехода по ссылке. Скрыт, если всё помещается на одну страницу. На узкой карточке вместо номеров —
 * «Страница N из M» между «Назад» и «Далее».
 */
function PageFooter({
  compact,
  page,
  pages,
  from,
  to,
  total,
  onPage,
}: {
  compact: boolean;
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations("references");
  const format = useFormat();
  // Недоступная кнопка остаётся в порядке Tab и сохраняет фокус (`aria-disabled`, а не `disabled`): нажатие на
  // «Далее», которое привело на последнюю страницу, не уводит фокус в никуда. Нажатие на неё Base UI не пропускает.
  const edge = "aria-disabled:pointer-events-none aria-disabled:opacity-50";
  const previous = (
    <Button
      variant={compact ? "outline" : "ghost"}
      className={edge}
      disabled={page <= 1}
      focusableWhenDisabled
      onClick={() => onPage(page - 1)}
    >
      <ChevronLeftIcon aria-hidden="true" />
      {t("previous")}
    </Button>
  );
  const next = (
    <Button
      variant={compact ? "outline" : "ghost"}
      className={edge}
      disabled={page >= pages}
      focusableWhenDisabled
      onClick={() => onPage(page + 1)}
    >
      {t("next")}
      <ChevronRightIcon aria-hidden="true" />
    </Button>
  );
  return (
    <div className={cn("flex gap-3", compact ? "flex-col items-stretch" : "items-center justify-between")}>
      {/* aria-live: смена страницы объявляется («Показано 51–100 из 120»). */}
      <p aria-live="polite" className={cn("text-sm text-muted-foreground tabular-nums", compact && "text-center")}>
        {t("shown", { from: format.number(from), to: format.number(to), total: format.number(total) })}
      </p>
      {compact ? (
        <Pagination aria-label={t("pagination")}>
          <PaginationContent className="w-full justify-between gap-2">
            <PaginationItem>{previous}</PaginationItem>
            <PaginationItem className="text-sm tabular-nums">
              {t("pageOf", { page: format.number(page), pages: format.number(pages) })}
            </PaginationItem>
            <PaginationItem>{next}</PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : (
        <Pagination aria-label={t("pagination")} className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>{previous}</PaginationItem>
            {pageItems(page, pages).map((item) =>
              typeof item === "number" ? (
                <PaginationItem key={item}>
                  <Button
                    variant={item === page ? "outline" : "ghost"}
                    size="icon"
                    aria-label={t("page", { page: format.number(item) })}
                    aria-current={item === page ? "page" : undefined}
                    onClick={() => onPage(item)}
                  >
                    {format.number(item)}
                  </Button>
                </PaginationItem>
              ) : (
                <PaginationItem key={item}>
                  <PaginationEllipsis />
                </PaginationItem>
              ),
            )}
            <PaginationItem>{next}</PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
