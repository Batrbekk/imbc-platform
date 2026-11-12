import { cn } from "cn";
import type { ComponentProps } from "react";

import { SelectContent } from "@/components/ui/select";

/**
 * Список выпадающего фильтра (OPR-02, REV-04). У кнопок фильтров ширина по подписи («Статус: Все»),
 * а `SelectContent` по умолчанию берёт ширину кнопки и совмещает выбранный вариант с ней: список
 * ложился поверх кнопки, и длинные варианты обрезались. Здесь список открывается под кнопкой,
 * не уже её и растёт до самого длинного варианта. Компонент `ui` не меняется.
 */
export function FilterSelectContent({ className, ...props }: ComponentProps<typeof SelectContent>) {
  return (
    <SelectContent
      alignItemWithTrigger={false}
      align="start"
      className={cn("w-auto min-w-(--anchor-width)", className)}
      {...props}
    />
  );
}
