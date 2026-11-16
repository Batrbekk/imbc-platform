import { Button } from "@/components/ui/button";
import { useTranslations } from "use-intl";
import { useFormat } from "@/i18n/format";
export function RecordsPaging({
  offset,
  total,
  disabled,
  change,
  label = "pagination",
}: {
  offset: number;
  total: number;
  disabled: boolean;
  change: (offset: number) => void;
  label?: string;
}) {
  const t = useTranslations("imbcRecords"),
    f = useFormat();
  return (
    <nav aria-label={t(label)} className="flex min-w-0 flex-wrap items-center gap-3">
      <span className="text-sm">{t("total", { total: f.number(total) })}</span>
      <Button variant="outline" disabled={disabled || offset === 0} onClick={() => change(Math.max(0, offset - 25))}>
        {t("previous")}
      </Button>
      <Button variant="outline" disabled={disabled || offset + 25 >= total} onClick={() => change(offset + 25)}>
        {t("next")}
      </Button>
    </nav>
  );
}
