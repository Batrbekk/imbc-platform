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
      <FilterSelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </FilterSelectContent>
    </Select>
  );
}
