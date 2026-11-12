// Версии NDA для показа: ADM-10, FC-03. Роль не решает: действий здесь нет, публикация — на экране администратора.
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import type { NdaVersion } from "@/prototype/data";
import { useDictionary } from "@/prototype/i18n";

import { sharedTexts } from "./texts";

/** Версии от новой к старой; текущая — опубликованная последней (`currentNda` в `rules.ts`). */
export function NdaVersionsView({
  versions,
  currentId,
  accountName,
}: {
  versions: NdaVersion[];
  currentId: string;
  /** Имя аккаунта по ключу: `(id) => accountName(state, id)`. */
  accountName: (accountId: string) => string;
}) {
  const t = useDictionary(sharedTexts);
  const format = useFormat();
  const sorted = [...versions].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return (
    <div className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("ndaVersion")}</TableHead>
            <TableHead>{t("ndaPublished")}</TableHead>
            <TableHead>{t("ndaPublishedBy")}</TableHead>
            <TableHead>{t("ndaSummary")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((version) => (
            <TableRow key={version.id}>
              <TableCell>
                <span className="inline-flex flex-wrap items-center gap-2">
                  NDA {version.version}
                  <Badge variant={version.id === currentId ? "default" : "outline"}>
                    {version.id === currentId ? t("ndaCurrent") : t("ndaEarlier")}
                  </Badge>
                </span>
              </TableCell>
              <TableCell>{format.dateTime(version.publishedAt)}</TableCell>
              <TableCell>{accountName(version.publishedBy)}</TableCell>
              <TableCell className="min-w-64 whitespace-normal">{version.summary}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-sm text-muted-foreground">{t("ndaKept")}</p>
    </div>
  );
}
