import { Select, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterSelectContent } from "@/routes/app/filter-select";

/** Выпадающий фильтр «Подпись: значение»; значение хранит экран в адресе. */
export function FilterSelect({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select items={items} value={value} onValueChange={(v) => typeof v === "string" && onChange(v)}>
      <SelectTrigger className="w-auto max-w-full min-w-0" aria-label={label}>
        <span className="shrink-0 text-muted-foreground">{label}:</span>
        <SelectValue className="truncate" />
      </SelectTrigger>
      {/* Список не шире экрана (390 px): длинные подписи переносятся, а не растягивают страницу. */}
      <FilterSelectContent className="max-w-[min(32rem,calc(100vw-2rem))]">
        {items.map((item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            className="[&>*]:shrink [&>*]:whitespace-normal [&>*]:[overflow-wrap:anywhere]"
          >
            {item.label}
          </SelectItem>
        ))}
      </FilterSelectContent>
    </Select>
  );
}
