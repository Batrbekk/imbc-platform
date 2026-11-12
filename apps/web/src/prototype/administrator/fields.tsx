// Поля форм в диалогах кабинета администратора: одна колонка, подпись над полем, ошибка под ним.
import { useId } from "react";

import { Field, FieldError, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

export function TextField({
  label,
  value,
  onChange,
  error,
  type = "text",
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Показывается, только если в поле уже что-то введено. */
  error?: string | null;
  type?: "text" | "email";
  multiline?: boolean;
}) {
  const id = useId();
  const shown = value.trim() !== "" && error ? error : null;
  return (
    <Field data-invalid={shown ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea
          id={id}
          value={value}
          aria-invalid={shown ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={id}
          type={type}
          value={value}
          aria-invalid={shown ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {shown && <FieldError>{shown}</FieldError>}
    </Field>
  );
}

/** Выбор одного варианта: подпись группы и варианты столбиком. */
export function ChoiceField<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V | null;
  options: { value: V; label: string }[];
  onChange: (value: V) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldTitle id={id}>{label}</FieldTitle>
      <RadioGroup
        aria-labelledby={id}
        value={value}
        onValueChange={(next) => {
          const option = options.find((o) => o.value === next);
          if (option) onChange(option.value);
        }}
      >
        {options.map((option) => (
          <Label key={option.value} className="font-normal">
            <RadioGroupItem value={option.value} aria-label={option.label} />
            {option.label}
          </Label>
        ))}
      </RadioGroup>
    </Field>
  );
}
