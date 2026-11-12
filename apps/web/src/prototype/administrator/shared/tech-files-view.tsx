// Файлы STR и KTRE для показа: ADM-15, FC-08 — по товарным группам, в группе по продуктам. Роль не решает: `readOnly` задаёт вызывающий.
import { COMMODITY_GROUPS } from "@imbc/contracts";
import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileRow } from "@/prototype/components";
import type { FileRef, TechFile } from "@/prototype/data";
import { useDictionary } from "@/prototype/i18n";

import { type TechProduct, techProducts } from "./model";
import { sharedTexts } from "./texts";

/**
 * Группы A–E, в группе — продукты с двумя местами: STR и KTRE. Без `readOnly` — выбор файла
 * (`onUpload`: загрузить или заменить) и `removeAction` (кнопка экрана с подтверждением).
 */
export function TechFilesView({
  files,
  readOnly,
  onUpload,
  removeAction,
}: {
  files: TechFile[];
  readOnly: boolean;
  onUpload?: (product: TechProduct, kind: TechFile["kind"], file: FileRef) => void;
  removeAction?: (file: TechFile) => ReactNode;
}) {
  const t = useDictionary(sharedTexts);
  const products = techProducts(files);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("tfIntro")}</p>
      {products.length === 0 && <p className="text-sm text-muted-foreground">{t("tfEmpty")}</p>}
      {COMMODITY_GROUPS.map((group) => {
        const inGroup = products.filter((p) => p.group === group);
        if (inGroup.length === 0 && readOnly) return null;
        return (
          <Card key={group}>
            <CardHeader>
              <CardTitle>{t("tfGroup", { group })}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {inGroup.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("tfEmptyGroup")}</p>
              ) : (
                inGroup.map((product) => (
                  <section key={product.key} className="flex flex-col gap-2" aria-label={product.product}>
                    <h3 className="text-sm font-medium">
                      {product.product} <span className="font-mono text-xs text-muted-foreground">{product.tnved}</span>
                    </h3>
                    {(["str", "ktre"] as const).map((kind) => {
                      const file = product[kind];
                      return (
                        <FileRow
                          key={kind}
                          label={`${kind === "str" ? t("tfStr") : t("tfKtre")} · ${product.product}`}
                          file={file?.file ?? null}
                          status={!readOnly && file ? removeAction?.(file) : undefined}
                          onSelect={readOnly || !onUpload ? undefined : (picked) => onUpload(product, kind, picked)}
                        />
                      );
                    })}
                  </section>
                ))
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
