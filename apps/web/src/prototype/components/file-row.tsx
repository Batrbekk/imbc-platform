import { ALLOWED_FILE_TYPES } from "@imbc/contracts";
import { FileIcon } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useFormat } from "@/i18n/format";

import type { FileRef } from "../data/common";
import { useCommonTexts } from "../labels";
import { nowIso } from "../store";

const ACCEPT = Object.values(ALLOWED_FILE_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

/**
 * Строка файла: подпись, имя, размер, дата, статус. С `onSelect` — выбор файла без отправки:
 * прототип отдаёт `FileRef` с именем, размером и временем выбора (DATA-05, DATA-06), содержимое
 * не читается и никуда не уходит. Скачивания нет: файлов в прототипе нет.
 */
export function FileRow({
  label,
  file,
  status,
  onSelect,
  disabled = false,
}: {
  label: string;
  file: FileRef | null;
  status?: ReactNode;
  onSelect?: (file: FileRef) => void;
  disabled?: boolean;
}) {
  const t = useCommonTexts();
  const format = useFormat();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <div className="flex min-w-0 items-start gap-2">
        <FileIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col">
          <span id={id} className="text-sm font-medium">
            {label}
          </span>
          {file ? (
            <span className="text-sm break-all text-muted-foreground">
              {file.name} · {t("sizeKb", { size: format.number(file.sizeKb) })} · {format.dateTime(file.uploadedAt)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">{t("noFile")}</span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {status}
        {onSelect && (
          <>
            <input
              ref={input}
              type="file"
              className="sr-only"
              accept={ACCEPT}
              aria-labelledby={id}
              aria-description={t("fileHint")}
              disabled={disabled}
              tabIndex={-1}
              onChange={(event) => {
                const picked = event.target.files?.[0];
                if (picked)
                  onSelect({
                    name: picked.name,
                    sizeKb: Math.max(1, Math.round(picked.size / 1024)),
                    uploadedAt: nowIso(),
                  });
                event.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
              {file ? t("replaceFile") : t("chooseFile")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
