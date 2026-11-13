import type { DictionaryCode, DictionaryEntry, DictionaryEntryResult, DictionaryEntryStatus } from "@imbc/contracts";
import { cn } from "cn";
import { MoreHorizontalIcon } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { hasMandatoryMark, isClosedDictionary, parentDictionaryOf } from "@/lib/references-params";

import { useAnnounce } from "./admin-actions";
import { EditEntryDialog } from "./references-dialogs";
import { useEntryName, useReferenceAction, useReferenceProblemMessage } from "./references-actions";

/** Что нужно строке: справочник, права и куда вести фокус, когда строка из списка уйдёт. */
interface RowContext {
  dictionary: DictionaryCode;
  canManage: boolean;
  status: DictionaryEntryStatus;
  /** Заголовок карточки: сюда переходит фокус, если строка пропала (удалена или ушла из вкладки). */
  focusAnchor: RefObject<HTMLElement | null>;
}

const entryPath = (dictionary: DictionaryCode, entry: DictionaryEntry) =>
  `/v1/dictionaries/${dictionary}/entries/${entry.id}`;

/** Состояние значения: «Действует» — спокойный бейдж, «Выведено из оборота» — контурный (DATA-04). */
function StateBadge({ entry }: { entry: DictionaryEntry }) {
  const t = useTranslations("references");
  return entry.retiredAt ? (
    <Badge variant="outline">{t("retired")}</Badge>
  ) : (
    <Badge variant="secondary">{t("inUse")}</Badge>
  );
}

/** Группа значения (только тип товара): код товарной группы бейджем; без группы — прочерк. */
function GroupBadge({ entry }: { entry: DictionaryEntry }) {
  return entry.parentCode ? (
    <Badge variant="outline" className="font-mono">
      {entry.parentCode}
    </Badge>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

/**
 * Переключатель «Обязательный» (ADM-09): срабатывает сразу, на время запроса стоит в новом положении с
 * индикатором ожидания, при сбое возвращается в прежнее, а причина объявляется в строке итога. Выведенное из
 * оборота значение обязательным не сделать (сервер: 409 `entry_retired`) — переключатель недоступен.
 */
function MandatorySwitch({
  dictionary,
  entry,
  label,
}: {
  dictionary: DictionaryCode;
  entry: DictionaryEntry;
  /** Видимая подпись справа от переключателя (в списке на телефоне); имя переключателя от неё не зависит. */
  label?: string;
}) {
  const t = useTranslations("references");
  const problem = useReferenceProblemMessage();
  const announce = useAnnounce();
  const toggle = useReferenceAction({
    request: (mandatory: boolean) =>
      api<DictionaryEntryResult>(`${entryPath(dictionary, entry)}/mandatory`, { method: "PUT", json: { mandatory } }),
    done: (result) =>
      result.entry.mandatory ? t("madeMandatory", { code: entry.code }) : t("madeOptional", { code: entry.code }),
  });
  const checked = toggle.isPending && toggle.variables !== undefined ? toggle.variables : entry.mandatory === true;
  return (
    <span className="inline-flex items-center gap-2">
      <Switch
        aria-label={`${t("mandatory")}: ${entry.code}`}
        aria-busy={toggle.isPending || undefined}
        checked={checked}
        disabled={!!entry.retiredAt}
        onCheckedChange={(next) =>
          toggle.run(next, { onError: (error) => announce({ tone: "error", text: problem(error) }) })
        }
      />
      {label && <span aria-hidden="true">{label}</span>}
      {/* Место под индикатор занято всегда: строка не прыгает, когда запрос начинается и заканчивается. */}
      <span className="inline-flex size-4 items-center justify-center" aria-hidden="true">
        {toggle.isPending && <Spinner aria-hidden="true" />}
      </span>
    </span>
  );
}

/**
 * Меню действий строки: «Изменить названия», «Вывести из оборота» или «Вернуть в оборот» (сразу, итог — в строке
 * состояния) и отдельной группой красное «Удалить» — после подтверждения. У закрытых справочников только правка
 * названий. Диалоги возвращают фокус на кнопку меню; если строка пропала, фокус уходит на заголовок карточки.
 * Права проверяет сервер (GEN-08): меню лишь не показывается тому, у кого права нет.
 */
function EntryActions({ entry, ...row }: { entry: DictionaryEntry } & RowContext) {
  const t = useTranslations("references");
  const problem = useReferenceProblemMessage();
  const announce = useAnnounce();
  const trigger = useRef<HTMLButtonElement>(null);
  const removed = useRef(false);
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const closed = isClosedDictionary(row.dictionary);
  const path = entryPath(row.dictionary, entry);

  // Строка уйдёт из вкладки после перечитывания: вывод и возврат переносят фокус на заголовок карточки.
  const leaves = row.status !== "all";
  const moveFocus = () => {
    if (leaves) row.focusAnchor.current?.focus();
  };

  const retire = useReferenceAction({
    request: () => api<DictionaryEntryResult>(`${path}/retire`, { method: "POST" }),
    done: () => t("retiredDone", { code: entry.code }),
  });
  const restore = useReferenceAction({
    request: () => api<DictionaryEntryResult>(`${path}/restore`, { method: "POST" }),
    done: () => t("restoredDone", { code: entry.code }),
  });
  const remove = useReferenceAction({
    request: () => api<void>(path, { method: "DELETE" }),
    done: () => t("deleted", { code: entry.code }),
  });
  const immediate = (action: typeof retire | typeof restore) =>
    action.run(undefined, {
      onSuccess: moveFocus,
      onError: (error) => announce({ tone: "error", text: problem(error) }),
    });

  const pending = retire.isPending || restore.isPending || remove.isPending;
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };
  // Пока запрос удаления в пути, подтверждение не закрывается (Escape, подложка, «Отмена»).
  const closeDelete = (open: boolean) => {
    if (!open && remove.isPending) return;
    close(open);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("actions", { code: entry.code })}
              aria-busy={pending || undefined}
            />
          }
        >
          {pending ? <Spinner aria-hidden="true" /> : <MoreHorizontalIcon aria-hidden="true" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-56 max-w-[calc(100vw-2rem)]">
          <DropdownMenuGroup>
            {/* Над пунктами — код значения: видно, над чем действие. */}
            <DropdownMenuLabel className="font-mono wrap-anywhere">{entry.code}</DropdownMenuLabel>
            <DropdownMenuItem disabled={pending} onClick={() => setDialog("edit")}>
              {t("edit")}
            </DropdownMenuItem>
            {!closed && (
              <DropdownMenuItem disabled={pending} onClick={() => immediate(entry.retiredAt ? restore : retire)}>
                {entry.retiredAt ? t("restore") : t("retire")}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {!closed && (
            <>
              {/* Удаление необратимо — отдельно и красным. */}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  remove.reset();
                  removed.current = false;
                  setDialog("delete");
                }}
              >
                {t("delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditEntryDialog
        dictionary={row.dictionary}
        entry={entry}
        open={dialog === "edit"}
        onOpenChange={close}
        finalFocus={trigger}
      />
      {!closed && (
        <AlertDialog open={dialog === "delete"} onOpenChange={closeDelete}>
          <AlertDialogContent finalFocus={() => (removed.current ? row.focusAnchor.current : trigger.current) ?? true}>
            <AlertDialogHeader>
              <AlertDialogTitle className="wrap-anywhere">{t("deleteTitle", { code: entry.code })}</AlertDialogTitle>
              <AlertDialogDescription>{t("deleteText")}</AlertDialogDescription>
            </AlertDialogHeader>
            {remove.isError && (
              <Alert variant="destructive">
                <AlertDescription>{problem(remove.error)}</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={remove.isPending}>{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={remove.isPending}
                onClick={() =>
                  remove.run(undefined, {
                    onSuccess: () => {
                      removed.current = true;
                      setDialog(null);
                    },
                  })
                }
              >
                {remove.isPending && <Spinner aria-hidden="true" />}
                {t("delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

/** «Обязательный»: переключатель у администратора, «Да»/«Нет» у директора (GEN-08). */
function MandatoryCell({ entry, ...row }: { entry: DictionaryEntry } & RowContext) {
  const t = useTranslations("references");
  if (row.canManage) return <MandatorySwitch dictionary={row.dictionary} entry={entry} />;
  return <span>{entry.mandatory ? t("yes") : t("no")}</span>;
}

/**
 * Значения справочника таблицей: «Код», «Название», «Группа» (тип товара), «Обязательный» (типы сертификатов и
 * документов), «Состояние» и меню действий (только у того, кто управляет). Для карточки шире 640 px.
 */
export function EntriesTable({
  items,
  listName,
  ...row
}: { items: readonly DictionaryEntry[]; listName: string } & RowContext) {
  const t = useTranslations("references");
  const entryName = useEntryName();
  const grouped = parentDictionaryOf(row.dictionary) !== null;
  const mandatory = hasMandatoryMark(row.dictionary);
  return (
    <Table aria-label={listName}>
      <TableHeader>
        <TableRow>
          <TableHead>{t("code")}</TableHead>
          <TableHead>{t("name")}</TableHead>
          {grouped && <TableHead>{t("group")}</TableHead>}
          {mandatory && <TableHead>{t("mandatory")}</TableHead>}
          <TableHead>{t("state")}</TableHead>
          {row.canManage && (
            <TableHead className="w-10">
              <span className="sr-only">{t("actionsColumn")}</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((entry) => (
          <TableRow key={entry.id} data-entry={entry.code}>
            {/* Код — текст как он записан: ведущие нули остаются (DATA-03); без переноса. */}
            <TableCell className="font-mono text-xs whitespace-nowrap">{entry.code}</TableCell>
            <TableCell className={cn("whitespace-normal wrap-anywhere", entry.retiredAt && "text-muted-foreground")}>
              {entryName(entry)}
            </TableCell>
            {grouped && (
              <TableCell>
                <GroupBadge entry={entry} />
              </TableCell>
            )}
            {mandatory && (
              <TableCell>
                <MandatoryCell entry={entry} {...row} />
              </TableCell>
            )}
            <TableCell>
              <StateBadge entry={entry} />
            </TableCell>
            {row.canManage && (
              <TableCell className="text-right">
                <EntryActions entry={entry} {...row} />
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Те же значения для узкой карточки (телефон, 390 px): две колонки без горизонтальной прокрутки. Слева — код,
 * название и бейджи (группа, «Обязательный» у директора, «Выведено из оборота»), под названием — переключатель
 * обязательности у администратора; справа — меню действий.
 */
export function EntriesList({
  items,
  listName,
  ...row
}: { items: readonly DictionaryEntry[]; listName: string } & RowContext) {
  const t = useTranslations("references");
  const entryName = useEntryName();
  const grouped = parentDictionaryOf(row.dictionary) !== null;
  const mandatory = hasMandatoryMark(row.dictionary);
  return (
    <ul role="list" aria-label={listName} className="flex flex-col divide-y rounded-lg border">
      {items.map((entry) => (
        <li
          key={entry.id}
          data-entry={entry.code}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 p-3"
        >
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="font-mono text-sm wrap-anywhere">{entry.code}</span>
            <span className={cn("wrap-anywhere", entry.retiredAt && "text-muted-foreground")}>{entryName(entry)}</span>
            <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
              {grouped && entry.parentCode && <GroupBadge entry={entry} />}
              {mandatory && !row.canManage && entry.mandatory && <Badge variant="secondary">{t("mandatory")}</Badge>}
              {entry.retiredAt && <Badge variant="outline">{t("retired")}</Badge>}
            </div>
            {mandatory && row.canManage && (
              <div className="text-sm">
                <MandatorySwitch dictionary={row.dictionary} entry={entry} label={t("mandatory")} />
              </div>
            )}
          </div>
          {row.canManage && <EntryActions entry={entry} {...row} />}
        </li>
      ))}
    </ul>
  );
}
