import {
  type DictionaryEntriesPage,
  type DictionaryEntry,
  entryDisplayName,
  FILE_PROBLEM_CODES,
  type FileProblemCode,
  type Locale,
  REFERENCE_PROBLEM_CODES,
  type ReferenceProblemCode,
} from "@imbc/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "use-intl";

import type { Messages } from "@/i18n/messages";
import { ApiError } from "@/lib/api";

import { useAdminAction } from "./admin-actions";

/** Всё, что страница справочников читает у сервера: списки значений и выбор групп. Действие перечитывает его. */
export const REFERENCES_KEY = ["references"] as const;

/** Образец оргструктуры: состояние и последняя загрузка (опрашивается, пока идёт проверка файла). */
export const ORG_CHART_SAMPLE_KEY = ["org-chart-sample"] as const;

type ProblemMessage = keyof Messages["references"]["errors"];

/**
 * Сообщение для каждого кода маршрутов справочников и файлов. Тип `Record<…>`: новый код в
 * `REFERENCE_PROBLEM_CODES` или `FILE_PROBLEM_CODES` без сообщения не скомпилируется, а ключ — из en.json (те же
 * ключи в kk и ru проверяет messages.test.ts). Нет сеанса или шлюза входа — одно сообщение о сеансе; сбой
 * запроса и ошибка сервера — общее «не удалось обработать запрос».
 */
export const REFERENCE_PROBLEM_MESSAGES: Record<ReferenceProblemCode | FileProblemCode, ProblemMessage> = {
  validation: "validation",
  unauthenticated: "session",
  mfa_required: "session",
  responsibility_required: "session",
  forbidden: "forbidden",
  bad_origin: "requestError",
  not_found: "not_found",
  entry_exists: "entry_exists",
  code_format: "code_format",
  parent_invalid: "parent_invalid",
  dictionary_closed: "dictionary_closed",
  mandatory_not_applicable: "mandatory_not_applicable",
  entry_mandatory: "entry_mandatory",
  entry_retired: "entry_retired",
  entry_in_use: "entry_in_use",
  busy: "busy",
  internal: "requestError",
  file_missing: "file_missing",
  file_empty: "file_empty",
  file_too_large: "file_too_large",
  file_type_not_allowed: "file_type_not_allowed",
  file_type_mismatch: "file_type_mismatch",
  file_structure_unsupported: "file_structure_unsupported",
  file_pending_scan: "file_pending_scan",
  file_rejected: "file_rejected",
  storage_unavailable: "storage_unavailable",
};

const KNOWN_CODES = new Set<string>([...REFERENCE_PROBLEM_CODES, ...FILE_PROBLEM_CODES]);

/** Код ответа, если он из списков справочников и файлов; `http_*`, сбой сети и прочее — undefined. */
export function problemCode(error: unknown): (ReferenceProblemCode | FileProblemCode) | undefined {
  return error instanceof ApiError && KNOWN_CODES.has(error.code)
    ? (error.code as ReferenceProblemCode | FileProblemCode)
    : undefined;
}

/**
 * Ключ сообщения об ошибке. Ответ без кода: 413 — отказ прокси (тело больше его предела), 415 — тип, который
 * не принимает загрузка; остальное — общее «не удалось обработать запрос».
 */
function problemKey(error: unknown): ProblemMessage {
  const code = problemCode(error);
  if (code) return REFERENCE_PROBLEM_MESSAGES[code];
  if (error instanceof ApiError && error.status === 413) return "file_too_large";
  if (error instanceof ApiError && error.status === 415) return "file_type_not_allowed";
  return "requestError";
}

/** Переведённое сообщение об ошибке действия; неизвестный код — общее «не удалось обработать запрос». */
export function useReferenceProblemMessage() {
  const t = useTranslations("references");
  return (error: unknown) => t(`errors.${problemKey(error)}`);
}

const isEntryResult = (value: unknown): value is { entry: DictionaryEntry } =>
  typeof value === "object" && value !== null && "entry" in value && typeof value.entry === "object";

/**
 * Подменяет значение во всех прочитанных списках, не дожидаясь перечитывания: переключатель обязательности
 * остаётся в новом положении, а не мигает прежним, пока приходит свежий список.
 */
function patchEntry(client: QueryClient, entry: DictionaryEntry) {
  client.setQueriesData<DictionaryEntriesPage>({ queryKey: [...REFERENCES_KEY, "entries"] }, (page) =>
    page ? { ...page, items: page.items.map((item) => (item.id === entry.id ? entry : item)) } : page,
  );
}

/**
 * Действие администратора над справочником: как `useAdminAction`, но перечитывает `REFERENCES_KEY` и кладёт
 * ответ сервера (`{ entry }`) в прочитанные списки сразу.
 */
export function useReferenceAction<TVariables, TResult>({
  request,
  done,
}: {
  request: (variables: TVariables) => Promise<TResult>;
  done: (result: TResult, variables: TVariables) => string;
}) {
  const client = useQueryClient();
  return useAdminAction({
    request: async (variables: TVariables) => {
      const result = await request(variables);
      if (isEntryResult(result)) patchEntry(client, result.entry);
      return result;
    },
    done,
    invalidate: [REFERENCES_KEY],
  });
}

/** Название значения для показа: язык интерфейса → kk → ru → en → код (ADM-08). Названия — данные, не переводятся (LANG-05). */
export function useEntryName() {
  const locale = useLocale() as Locale;
  return (entry: Pick<DictionaryEntry, "names" | "code">) => entryDisplayName(entry.names, locale, entry.code);
}
