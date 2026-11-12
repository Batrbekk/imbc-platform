// Мелкие общие части экранов оператора: строка списка определений и «не найдено».
import type { ReactNode } from "react";
import { Link } from "react-router";

import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Строка `<dl>` как на странице компании (`routes/app/company.tsx`). */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Записи нет или она недоступна роли: понятное состояние со ссылкой на список. */
export function NotFound({ text, backLabel, backTo }: { text: string; backLabel: string; backTo: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link className={buttonVariants({ variant: "outline" })} to={backTo}>
          {backLabel}
        </Link>
      </EmptyContent>
    </Empty>
  );
}

/**
 * Выбор из списка с подписью над ним. Base UI нужен `items`, иначе `SelectValue` покажет сырое
 * значение; список открывается под кнопкой и не уже её.
 */
export function Choice({
  id,
  label,
  value,
  items,
  onChange,
  className,
}: {
  id: string;
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={className ?? "flex flex-col gap-2"}>
      <Label id={`${id}-label`}>{label}</Label>
      <Select items={items} value={value} onValueChange={(v) => v !== null && onChange(String(v))}>
        <SelectTrigger className="w-full sm:w-auto sm:min-w-56" aria-labelledby={`${id}-label`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-(--anchor-width)">
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
