// Справочник и образец оргструктуры для показа: ADM-08, ADM-09, ADM-11, DATA-04. Роль не решает: `readOnly` задаёт вызывающий.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileRow } from "@/prototype/components";
import type { FileRef, ReferenceItem, ReferenceList } from "@/prototype/data";
import { useDictionary } from "@/prototype/i18n";

import { hasMandatoryMark } from "./model";
import { sharedTexts } from "./texts";

/**
 * Значения одного справочника. Без `readOnly` — переключатель «обязательный» (ADM-09) и вывод из оборота
 * и возврат (DATA-04) через колбэки; с `readOnly` — только просмотр (кабинет директора, GEN-04).
 */
export function ReferenceListView({
  list,
  readOnly,
  onMandatoryChange,
  onRetiredChange,
}: {
  list: ReferenceList;
  readOnly: boolean;
  onMandatoryChange?: (item: ReferenceItem, mandatory: boolean) => void;
  onRetiredChange?: (item: ReferenceItem, retired: boolean) => void;
}) {
  const t = useDictionary(sharedTexts);
  const mandatory = hasMandatoryMark(list);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {mandatory && `${t("mandatoryHint")} `}
        {t("retireHint")}
      </p>
      {list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("emptyList")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("code")}</TableHead>
              <TableHead>{t("value")}</TableHead>
              {mandatory && <TableHead>{t("mandatory")}</TableHead>}
              <TableHead>{t("state")}</TableHead>
              {!readOnly && <TableHead className="sr-only">{t("retire")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((item) => (
              <TableRow key={item.code}>
                <TableCell className="font-mono text-xs">{item.code}</TableCell>
                <TableCell className="whitespace-normal">{item.label}</TableCell>
                {mandatory && (
                  <TableCell>
                    {readOnly ? (
                      item.mandatory ? (
                        t("yes")
                      ) : (
                        t("no")
                      )
                    ) : (
                      <Switch
                        aria-label={`${t("mandatory")}: ${item.label}`}
                        checked={item.mandatory ?? false}
                        onCheckedChange={(checked) => onMandatoryChange?.(item, checked)}
                      />
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <Badge variant={item.retired ? "outline" : "secondary"}>
                    {item.retired ? t("retired") : t("inUse")}
                  </Badge>
                </TableCell>
                {!readOnly && (
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`${item.retired ? t("restore") : t("retire")}: ${item.label}`}
                      onClick={() => onRetiredChange?.(item, !item.retired)}
                    >
                      {item.retired ? t("restore") : t("retire")}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** Образец оргструктуры (ADM-11, MAN-19). Без `readOnly` — замена файла через `onReplace`. */
export function OrgChartSampleView({
  file,
  readOnly,
  onReplace,
}: {
  file: FileRef;
  readOnly: boolean;
  onReplace?: (file: FileRef) => void;
}) {
  const t = useDictionary(sharedTexts);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("orgChartTitle")}</CardTitle>
        <CardDescription>{t("orgChartHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FileRow label={t("orgChartLabel")} file={file} onSelect={readOnly ? undefined : onReplace} />
      </CardContent>
    </Card>
  );
}
