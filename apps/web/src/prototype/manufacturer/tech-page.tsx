// STR и KTRE (Release 2): свой раздел, файлы по товарным группам и продуктам, просмотр без скачивания.
// FC-01, FC-03, FC-08, FC-09.
import { COMMODITY_GROUPS } from "@imbc/contracts";
import { MinusIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useFormat } from "@/i18n/format";

import type { TechFile } from "../data";
import { useDictionary } from "../i18n";
import { useProto } from "../store";
import { NdaGate } from "./nda-gate";
import { ManufacturerPage } from "./page";
import { screenTexts } from "./screen-texts";
import { useViewedProfile } from "./view-as";

export function TechPage() {
  const t = useDictionary(screenTexts);
  const { profile } = useViewedProfile();
  return (
    <ManufacturerPage title={t("techTitle")} release2 description={t("techDescription")}>
      <NdaGate profile={profile}>
        <TechFiles />
      </NdaGate>
    </ManufacturerPage>
  );
}

function TechFiles() {
  const t = useDictionary(screenTexts);
  const files = useProto((s) => s.techFiles);
  const [open, setOpen] = useState<TechFile | null>(null);
  const groups = COMMODITY_GROUPS.filter((g) => files.some((f) => f.group === g));
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertDescription>{t("techNotCatalogue")}</AlertDescription>
      </Alert>
      {groups.map((g) => {
        const products = [...new Set(files.filter((f) => f.group === g).map((f) => `${f.tnved}|${f.product}`))];
        return (
          <Card key={g}>
            <CardHeader>
              <CardTitle>{t("fcGroupN", { group: g })}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col divide-y">
              {products.map((key) => {
                const [tnved, product] = key.split("|") as [string, string];
                const own = files.filter((f) => f.group === g && f.tnved === tnved);
                return (
                  <div key={key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="flex flex-col text-sm">
                      <span className="font-medium">{product}</span>
                      <span className="font-mono text-muted-foreground">{tnved}</span>
                    </span>
                    <span className="flex flex-wrap gap-2">
                      {own.map((f) => (
                        <Button
                          key={f.id}
                          size="sm"
                          variant="outline"
                          aria-label={t("techOpenOf", { kind: t(`techKind.${f.kind}`), product })}
                          onClick={() => setOpen(f)}
                        >
                          {t("techOpen", { kind: t(`techKind.${f.kind}`) })}
                        </Button>
                      ))}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
      <Viewer file={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Просмотр PDF на платформе: масштаб и прокрутка, без скачивания и печати (FC-08). */
function Viewer({ file, onClose }: { file: TechFile | null; onClose: () => void }) {
  const t = useDictionary(screenTexts);
  const format = useFormat();
  const [zoom, setZoom] = useState(100);
  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        {file && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {file.product} <Badge variant="outline">{t(`techKind.${file.kind}`)}</Badge>
              </DialogTitle>
              <DialogDescription>{t("techViewerHint", { name: file.file.name })}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={t("techZoomOut")}
                onClick={() => setZoom((z) => Math.max(50, z - 25))}
              >
                <MinusIcon />
              </Button>
              <span className="text-sm tabular-nums">{t("techZoom", { zoom: format.number(zoom) })}</span>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={t("techZoomIn")}
                onClick={() => setZoom((z) => Math.min(200, z + 25))}
              >
                <PlusIcon />
              </Button>
            </div>
            <div className="h-72 overflow-auto rounded-lg border bg-muted/40 p-4 select-none print:hidden">
              <div style={{ fontSize: `${zoom}%` }} className="flex flex-col gap-3 text-sm">
                <p className="font-medium">
                  {t(`techKind.${file.kind}`)} · {file.product} · {file.tnved}
                </p>
                <p>{t("techSampleText")}</p>
                <p>{t("techSampleText2")}</p>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
