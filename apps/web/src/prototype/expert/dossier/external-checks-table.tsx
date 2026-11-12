// Результаты внешних проверок профиля (EXT-01, EXT-02, EXT-04): коннектор, статус, значение, источник, дата;
// результат заглушки помечен как тестовые данные. Только показ.
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import type { ExternalCheck } from "@/prototype/data";
import { useDictionary } from "@/prototype/i18n";
import { useCommonTexts } from "@/prototype/labels";

import { SIM_PREFIX, type SimTextKey } from "./helpers";
import { dossierTexts } from "./texts";

export function ExternalChecksTable({ checks }: { checks: ExternalCheck[] }) {
  const t = useDictionary(dossierTexts);
  const common = useCommonTexts();
  const format = useFormat();
  if (checks.length === 0) return <p className="text-sm text-muted-foreground">{t("checksEmpty")}</p>;
  const sorted = [...checks].sort((a, b) => b.at.localeCompare(a.at));
  // Тексты имитации — ключи словаря с префиксом (`simText`), остальное — данные как есть.
  const text = (value: string) => {
    const key = value.startsWith(SIM_PREFIX) ? value.slice(SIM_PREFIX.length) : null;
    return key && key in dossierTexts.en ? t(key as SimTextKey) : value;
  };
  const result = (c: ExternalCheck) =>
    c.connector === "adata" && (c.result === "green" || c.result === "amber" || c.result === "red")
      ? common(`dd.${c.result}`)
      : text(c.result);
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("connector")}</TableHead>
            <TableHead>{t("checkStatus")}</TableHead>
            <TableHead>{t("checkResult")}</TableHead>
            <TableHead>{t("checkSource")}</TableHead>
            <TableHead>{t("checkAt")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{t(`connector.${c.connector}`)}</TableCell>
              <TableCell>
                {/* Недоступность — не находка и не «внимание» (EXT-04). */}
                <Badge variant="outline">{t(`checkStatus.${c.status}`)}</Badge>
              </TableCell>
              <TableCell className="whitespace-normal">
                {result(c)} {c.testData && <Badge variant="secondary">{t("testData")}</Badge>}
              </TableCell>
              <TableCell className="whitespace-normal">{text(c.source)}</TableCell>
              <TableCell className="text-xs">{format.dateTime(c.at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
