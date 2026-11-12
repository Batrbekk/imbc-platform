// Поля форм секций профиля: подпись, обязательность, блокировка (MAN-43), файл с историей (MAN-36).
import { type ReactNode, use, useId } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/i18n/format";

import { FileRow } from "../components";
import type { FileRef } from "../data";
import { useDictionary } from "../i18n";
import { useExt } from "../store";
import { LockedContext } from "./locked";
import { historyKey, readExt } from "./model";
import { texts } from "./texts";

function Caption({ label, required }: { label: string; required?: boolean }) {
  return (
    <>
      {label}
      {required && (
        <span aria-hidden className="text-destructive">
          *
        </span>
      )}
    </>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  readOnly = false,
  description,
  error,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  type?: "text" | "email" | "tel" | "date" | "url";
  required?: boolean;
  readOnly?: boolean;
  description?: ReactNode;
  error?: string | null;
  multiline?: boolean;
}) {
  const locked = use(LockedContext);
  const id = useId();
  const disabled = locked || readOnly || !onChange;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>
        <Caption label={label} required={required} />
      </FieldLabel>
      {multiline ? (
        <Textarea id={id} value={value} disabled={disabled} onChange={(e) => onChange?.(e.target.value)} />
      ) : (
        <Input
          id={id}
          type={type}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange?.(e.target.value)}
        />
      )}
      {description && <FieldDescription>{description}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  required = false,
  min = 0,
  max,
  error,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  required?: boolean;
  min?: number;
  max?: number;
  error?: string | null;
}) {
  const locked = use(LockedContext);
  const id = useId();
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>
        <Caption label={label} required={required} />
      </FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value ?? ""}
        disabled={locked}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          const n = Number(raw);
          onChange(raw === "" || !Number.isFinite(n) ? null : n);
        }}
      />
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

export interface Choice {
  value: string;
  label: string;
}

export function ChoiceField({
  label,
  value,
  items,
  onChange,
  required = false,
  placeholder,
}: {
  label: string;
  value: string | null;
  items: Choice[];
  onChange: (value: string | null) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const locked = use(LockedContext);
  const id = useId();
  const all = placeholder !== undefined ? [{ value: null, label: placeholder }, ...items] : items;
  return (
    <Field>
      <Label id={id}>
        <Caption label={label} required={required} />
      </Label>
      <Select
        items={all}
        value={value}
        onValueChange={(v) => onChange(typeof v === "string" ? v : null)}
        disabled={locked}
      >
        <SelectTrigger className="w-full" aria-labelledby={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {all.map((item) => (
            <SelectItem key={item.value ?? ""} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: ReactNode;
}) {
  const locked = use(LockedContext);
  const id = useId();
  return (
    <Field orientation="horizontal">
      <Checkbox id={id} checked={checked} disabled={locked} onCheckedChange={(c) => onChange(c)} />
      <div className="flex flex-col gap-0.5">
        <FieldLabel htmlFor={id} className="font-normal">
          {label}
        </FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </div>
    </Field>
  );
}

/**
 * Файл в слоте секции: выбор без отправки (`FileRow`) и прежние версии этого слота (MAN-36).
 * `slot` — ключ истории, `null` — у файла нет истории (новая строка, фото, CV).
 */
export function FileSlot({
  label,
  file,
  onSelect,
  status,
  profileId,
  slot,
}: {
  label: string;
  file: FileRef | null;
  onSelect?: (file: FileRef) => void;
  status?: ReactNode;
  profileId: string;
  slot: string | null;
}) {
  const t = useDictionary(texts);
  const format = useFormat();
  const locked = use(LockedContext);
  const ext = readExt(useExt<unknown>("manufacturer", null));
  const history = slot ? (ext.fileHistory[historyKey(profileId, slot)] ?? []) : [];
  return (
    <div className="flex flex-col gap-1">
      <FileRow label={label} file={file} status={status} onSelect={onSelect} disabled={locked} />
      {history.length > 0 && (
        <div className="pl-3 text-xs text-muted-foreground">
          <span className="font-medium">{t("earlierVersions")}</span>
          <ul className="flex flex-col">
            {[...history].reverse().map((f) => (
              <li key={`${f.name}-${f.uploadedAt}`} className="break-all">
                {f.name} · {format.dateTime(f.uploadedAt)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Кнопка «Сохранить секцию» и ошибки проверки при сохранении (MAN-13, MAN-15); в блокировке не видна. */
export function SaveBar({ onSave, errors }: { onSave: () => void; errors: string[] }) {
  const t = useDictionary(texts);
  const locked = use(LockedContext);
  if (locked) return null;
  return (
    <div className="flex flex-col gap-2">
      {errors.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-destructive">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div>
        <Button onClick={onSave}>{t("save")}</Button>
      </div>
    </div>
  );
}

/** Карточка строки списка (контакт, акционер, продукт) с заголовком и кнопкой «Удалить». */
export function RowCard({
  title,
  onRemove,
  children,
}: {
  title: ReactNode;
  onRemove?: () => void;
  children: ReactNode;
}) {
  const t = useDictionary(texts);
  const locked = use(LockedContext);
  const id = useId();
  return (
    <fieldset aria-labelledby={id} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={id} className="text-sm font-medium">
          {title}
        </span>
        {onRemove && !locked && (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            {t("remove")}
          </Button>
        )}
      </div>
      {children}
    </fieldset>
  );
}

/** Сетка полей: одна колонка на узком экране, две на широком. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>;
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  const locked = use(LockedContext);
  if (locked) return null;
  return (
    <div>
      <Button variant="outline" size="sm" onClick={onClick}>
        {label}
      </Button>
    </div>
  );
}
