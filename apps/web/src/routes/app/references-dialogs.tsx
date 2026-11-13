import {
  type CreateDictionaryEntryInput,
  DICTIONARY_CODE_PATTERNS,
  DICTIONARY_SORT_ORDER_MAX,
  type DictionaryChoicesPage,
  type DictionaryCode,
  type DictionaryEntry,
  type DictionaryEntryResult,
  type Locale,
  type UpdateDictionaryEntryInput,
} from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { type ReactElement, type RefObject, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";
import { hasMandatoryMark, parentDictionaryOf } from "@/lib/references-params";

import { type Action } from "./admin-actions";
import { AdminDialog, DialogForm, type FinalFocus, SelectField, TextField } from "./admin-dialogs";
import { problemCode, REFERENCES_KEY, useReferenceAction, useReferenceProblemMessage } from "./references-actions";

const NAME_LOCALES = ["kk", "ru", "en"] as const;
const NAME_LABELS = { kk: "nameKk", ru: "nameRu", en: "nameEn" } as const;
type FieldName = "code" | "kk" | "ru" | "en" | "sortOrder";

/** Введённое в форму, уже без пробелов по краям; порядок — число (только в правке). */
interface Values {
  code: string;
  names: { kk: string; ru: string; en: string };
  parentCode: string | null;
  mandatory: boolean;
  sortOrder: number;
}

/** Подсказка формата кода: у ТН ВЭД, ОКЭД и КПВЭД он жёсткий, у остальных — латиница, цифры и знаки. */
const codeHintKey = (dictionary: DictionaryCode) =>
  dictionary === "tn_ved" || dictionary === "oked" || dictionary === "kpved" ? dictionary : "other";

/**
 * Значения родительского справочника для выбора группы (только действующие): запрос идёт, пока открыт диалог.
 * Название — на языке интерфейса, рядом код группы. Группа необязательна: сервер принимает `parentCode: null`.
 */
function useParentChoices(parent: DictionaryCode | null) {
  const locale = useLocale() as Locale;
  return useQuery({
    queryKey: [...REFERENCES_KEY, "choices", parent, locale],
    queryFn: () => api<DictionaryChoicesPage>(`/v1/dictionaries/${parent}/choices?lang=${locale}`),
    enabled: parent !== null,
    select: (page) => page.items.map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` })),
  });
}

/** Новое значение справочника (ADM-08): код, три названия, группа у типа товара, «Обязательный тип» у типов сертификатов и документов. */
export function AddEntryDialog({
  dictionary,
  trigger,
  fallbackFocus,
}: {
  dictionary: DictionaryCode;
  trigger: ReactElement;
  /**
   * Куда перевести фокус после удачного добавления, если кнопка исчезнет со страницы (кнопка из сообщения о
   * пустом справочнике: в списке появляется значение). Отмена и закрытие без добавления возвращают фокус на кнопку.
   */
  fallbackFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("references");
  const [open, setOpen] = useState(false);
  const created = useRef(false);
  const action = useReferenceAction({
    request: (input: CreateDictionaryEntryInput) =>
      api<DictionaryEntryResult>(`/v1/dictionaries/${dictionary}/entries`, { method: "POST", json: input }),
    done: (result) => t("added", { code: result.entry.code }),
  });
  return (
    <AdminDialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          action.reset();
          created.current = false;
        }
        setOpen(next);
      }}
      locked={action.isPending}
      finalFocus={fallbackFocus && (() => (created.current ? fallbackFocus.current : true))}
      trigger={trigger}
    >
      <EntryForm
        mode="create"
        dictionary={dictionary}
        action={action}
        toInput={(values) => ({
          code: values.code,
          parentCode: values.parentCode,
          names: values.names,
          ...(hasMandatoryMark(dictionary) ? { mandatory: values.mandatory } : {}),
        })}
        close={() => {
          created.current = true;
          setOpen(false);
        }}
      />
    </AdminDialog>
  );
}

/** Правка названий, порядка и группы (ADM-08); код не меняется. Открывается из меню строки и возвращает фокус на него. */
export function EditEntryDialog({
  dictionary,
  entry,
  open,
  onOpenChange,
  finalFocus,
}: {
  dictionary: DictionaryCode;
  entry: DictionaryEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: FinalFocus;
}) {
  const t = useTranslations("references");
  const action = useReferenceAction({
    request: (input: UpdateDictionaryEntryInput) =>
      api<DictionaryEntryResult>(`/v1/dictionaries/${dictionary}/entries/${entry.id}`, { method: "PUT", json: input }),
    done: () => t("updated", { code: entry.code }),
  });
  return (
    <AdminDialog
      open={open}
      onOpenChange={(next) => {
        if (next) action.reset();
        onOpenChange(next);
      }}
      locked={action.isPending}
      finalFocus={finalFocus}
    >
      <EntryForm
        mode="edit"
        dictionary={dictionary}
        entry={entry}
        action={action}
        toInput={(values) => ({ names: values.names, sortOrder: values.sortOrder, parentCode: values.parentCode })}
        close={() => onOpenChange(false)}
      />
    </AdminDialog>
  );
}

/**
 * Форма значения. Коды — только текст: поле `type="text"`, ведущие нули не теряются (DATA-03). Все три названия
 * обязательны (форма администратора); группа типа товара — нет: первый пункт списка «Без группы» (`null`), такие
 * значения есть и на стенде, и их нужно уметь править. У закрытых справочников диалога добавления нет. Ошибка
 * сервера у кода (`entry_exists`, `code_format`) и у группы (`parent_invalid`) — у своего поля, с фокусом на нём;
 * остальные — Alert.
 * Тело запроса собирает вызывающий (`toInput`): создание и правка отправляют разные поля.
 */
function EntryForm<TInput>({
  dictionary,
  mode,
  entry,
  action,
  toInput,
  close,
}: {
  dictionary: DictionaryCode;
  mode: "create" | "edit";
  entry?: DictionaryEntry;
  action: Action<TInput>;
  toInput: (values: Values) => TInput;
  close: () => void;
}) {
  const t = useTranslations("references");
  const common = useTranslations("common");
  const format = useFormat();
  const problem = useReferenceProblemMessage();
  const id = useId();
  const parent = parentDictionaryOf(dictionary);
  const choices = useParentChoices(parent);

  // Состояние на момент открытия: перечитанный после успеха список не меняет форму закрывающегося диалога.
  const [initial] = useState(() => ({
    names: { kk: entry?.names.kk ?? "", ru: entry?.names.ru ?? "", en: entry?.names.en ?? "" },
    sortOrder: String(entry?.sortOrder ?? 0),
    parentCode: entry?.parentCode ?? null,
  }));
  const [code, setCode] = useState("");
  const [names, setNames] = useState(initial.names);
  const [sortOrder, setSortOrder] = useState(initial.sortOrder);
  const [parentCode, setParentCode] = useState<string | null>(initial.parentCode);
  const [mandatory, setMandatory] = useState(false);
  const [invalid, setInvalid] = useState<Partial<Record<FieldName, string>>>({});
  const [focusRequest, setFocusRequest] = useState(0);

  const serverCode = problemCode(action.error);
  const codeFromServer = serverCode === "entry_exists" || serverCode === "code_format";
  const groupFromServer = serverCode === "parent_invalid";

  const edit = (field: FieldName, patch: () => void) => {
    patch();
    setInvalid((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    if (action.isError) action.reset();
  };

  const unchanged =
    mode === "edit" &&
    NAME_LOCALES.every((locale) => names[locale].trim() === initial.names[locale].trim()) &&
    sortOrder.trim() === initial.sortOrder &&
    parentCode === initial.parentCode;

  const submit = () => {
    const errors: Partial<Record<FieldName, string>> = {};
    const trimmed = code.trim();
    if (mode === "create") {
      if (!trimmed) errors.code = t("fieldErrors.codeRequired");
      else if (!DICTIONARY_CODE_PATTERNS[dictionary].test(trimmed)) errors.code = t("errors.code_format");
    }
    for (const locale of NAME_LOCALES) if (!names[locale].trim()) errors[locale] = t("fieldErrors.name");
    const order = Number(sortOrder.trim());
    if (mode === "edit" && !(/^\d+$/.test(sortOrder.trim()) && order <= DICTIONARY_SORT_ORDER_MAX))
      errors.sortOrder = t("fieldErrors.sortOrder", { max: format.number(DICTIONARY_SORT_ORDER_MAX) });
    if (Object.keys(errors).length > 0) {
      setInvalid(errors);
      setFocusRequest((n) => n + 1);
      return;
    }
    action.run(
      toInput({
        code: trimmed,
        names: { kk: names.kk.trim(), ru: names.ru.trim(), en: names.en.trim() },
        parentCode: parent ? parentCode : null,
        mandatory,
        sortOrder: order,
      }),
      { onSuccess: close },
    );
  };

  const chooseGroup = (next: string | null) => {
    setParentCode(next);
    if (action.isError) action.reset();
  };

  const codeError = invalid.code ?? (codeFromServer ? t(`errors.${serverCode}`) : undefined);
  const groupError = groupFromServer ? t("errors.parent_invalid") : undefined;
  const groupOptions = choices.data ?? [];
  // Группа правки может быть вне списка действующих (выведена): тогда она остаётся выбранной и видна.
  const groupItems =
    parentCode && !groupOptions.some((option) => option.value === parentCode)
      ? [{ value: parentCode, label: parentCode }, ...groupOptions]
      : groupOptions;

  return (
    <DialogForm
      title={mode === "create" ? t("addTitle") : t("editTitle", { code: entry?.code ?? "" })}
      description={mode === "create" ? t("addHint") : t("editHint")}
      submitLabel={mode === "create" ? t("add") : t("save")}
      cancelLabel={t("cancel")}
      pending={action.isPending}
      submitDisabled={unchanged}
      error={action.isError && !codeFromServer && !groupFromServer ? problem(action.error) : undefined}
      // Ошибка сервера у поля: каждый новый отказ (новое время отправки) возвращает фокус на это поле.
      focusRequest={focusRequest + (codeFromServer || groupFromServer ? action.submittedAt : 0)}
      onSubmit={submit}
    >
      {mode === "create" && (
        <TextField
          id={`${id}-code`}
          label={t("code")}
          // Код — текст, а не число: ведущие нули сохраняются; цифровая клавиатура — у кодов из цифр.
          type="text"
          inputMode={dictionary === "tn_ved" || dictionary === "oked" ? "numeric" : "text"}
          autoComplete="off"
          maxLength={64}
          value={code}
          onChange={(next) => edit("code", () => setCode(next))}
          hint={t(`codeHint.${codeHintKey(dictionary)}`)}
          error={codeError}
        />
      )}
      {NAME_LOCALES.map((locale) => (
        <TextField
          key={locale}
          id={`${id}-${locale}`}
          label={t(NAME_LABELS[locale])}
          autoComplete="off"
          maxLength={500}
          value={names[locale]}
          onChange={(next) => edit(locale, () => setNames((current) => ({ ...current, [locale]: next })))}
          error={invalid[locale]}
        />
      ))}
      {mode === "edit" && (
        <TextField
          id={`${id}-order`}
          label={t("sortOrder")}
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          hint={t("sortOrderHint")}
          value={sortOrder}
          onChange={(next) => edit("sortOrder", () => setSortOrder(next))}
          error={invalid.sortOrder}
        />
      )}
      {parent && (
        <SelectField
          id={`${id}-group`}
          label={t("groupLabel")}
          value={parentCode}
          emptyOption={{ label: t("noGroup"), onSelect: () => chooseGroup(null) }}
          options={groupItems}
          disabled={choices.isPending}
          onChange={chooseGroup}
          error={groupError ?? (choices.isError ? t("groupLoadError") : undefined)}
          errorAction={
            choices.isError ? (
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={choices.isFetching}
                  onClick={() => void choices.refetch()}
                >
                  {common("retry")}
                </Button>
              </div>
            ) : undefined
          }
        />
      )}
      {mode === "create" && hasMandatoryMark(dictionary) && (
        // Поле с флажком из реестра shadcn (field-checkbox): FieldContent включает `items-start` у Field, флажок
        // стоит у первой строки — подписи, а пояснение идёт под ней.
        <Field orientation="horizontal">
          <Checkbox
            id={`${id}-mandatory`}
            checked={mandatory}
            onCheckedChange={(checked) => setMandatory(checked === true)}
            aria-describedby={`${id}-mandatory-help`}
          />
          <FieldContent>
            <FieldLabel htmlFor={`${id}-mandatory`}>{t("mandatoryType")}</FieldLabel>
            <FieldDescription id={`${id}-mandatory-help`}>{t("mandatoryHint")}</FieldDescription>
          </FieldContent>
        </Field>
      )}
    </DialogForm>
  );
}
