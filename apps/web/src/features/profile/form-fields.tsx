import { fieldId, useFieldMessage } from "./form-data";
import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "use-intl";
import { useFormat } from "@/i18n/format";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SectionFieldErrors } from "./section-draft";

export function ProfileTextField({
  path,
  label,
  value,
  onChange,
  disabled,
  errors,
  type = "text",
  hint,
}: {
  path: string;
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  disabled: boolean;
  errors: SectionFieldErrors;
  type?: "text" | "email" | "tel" | "url" | "date";
  hint?: string;
}) {
  const error = useFieldMessage(errors[path]);
  const format = useFormat();
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={fieldId(path)}>{label}</FieldLabel>
      {disabled ? <Textarea
        id={fieldId(path)}
        value={type === "date" ? format.date(value) : value ?? ""}
        readOnly
        rows={1}
        className="min-h-9 resize-none overflow-hidden [overflow-wrap:anywhere]"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId(path)}-error` : undefined}
      /> : <Input
        id={fieldId(path)}
        type={type}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId(path)}-error` : undefined}
      />}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <FieldError id={`${fieldId(path)}-error`}>{error}</FieldError>}
    </Field>
  );
}

export function ProfileChoiceField({
  path,
  label,
  value,
  onChange,
  disabled,
  errors,
  choices,
}: {
  path: string;
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled: boolean;
  errors: SectionFieldErrors;
  choices: readonly { value: string; label: string; disabled?: boolean }[];
}) {
  const t = useTranslations("profileEditor");
  const error = useFieldMessage(errors[path]);
  const items = [{ value: null, label: t("selectPlaceholder") }, ...choices];
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={fieldId(path)}>{label}</FieldLabel>
      <Select items={items} value={value} onValueChange={(next) => onChange(next)} disabled={disabled}>
        <SelectTrigger
          id={fieldId(path)}
          className="w-full"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${fieldId(path)}-error` : undefined}
        >
          <SelectValue>{choices.find((choice) => choice.value === value)?.label ?? t("selectPlaceholder")}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {items.map((item) => (
            <SelectItem
              key={item.value ?? "empty"}
              value={item.value}
              disabled={"disabled" in item && Boolean(item.disabled)}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <FieldError id={`${fieldId(path)}-error`}>{error}</FieldError>}
    </Field>
  );
}

/** Group and server-owned identity errors must be visible even without a matching editable input. */
export function ProfileGroupError({ path, errors }: { path: string; errors: SectionFieldErrors }) {
  const error = useFieldMessage(errors[path]);
  return error ? <FieldError id={`${fieldId(path)}-error`}>{error}</FieldError> : null;
}

export function ProfileRowActions({
  index,
  count,
  disabled,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  disabled: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("profileEditor");
  return (
    <div className="flex gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || index === 0}
        aria-label={t("moveUp")}
        onClick={() => onMove(index - 1)}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || index === count - 1}
        aria-label={t("moveDown")}
        onClick={() => onMove(index + 1)}
      >
        <ArrowDownIcon />
      </Button>
      <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={t("remove")} onClick={onRemove}>
        <Trash2Icon />
      </Button>
    </div>
  );
}
