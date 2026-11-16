import type { DiligenceRead } from "@imbc/contracts";
import { useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { runDiligence } from "./api";
import { DiligenceEditor } from "./editor";
import { DiligenceFailure } from "./feedback";

/** Mounted only for an SME. Directors never mount mutation handlers or upload queries. */
export function DiligenceActions({ data, actorId, canRun, changed }: { data: DiligenceRead; actorId: string; canRun: boolean; changed: (data: DiligenceRead) => void }) {
  const t = useTranslations("diligence");
  const [mode, setMode] = useState<"override" | "enhanced" | null>(null), [running, setRunning] = useState(false), [failure, setFailure] = useState<unknown>(null), [saved, setSaved] = useState(false);
  const overrideRef = useRef<HTMLButtonElement>(null), enhancedRef = useRef<HTMLButtonElement>(null);
  async function run() {
    if (running || data.lastRun?.state === "waiting") return;
    setRunning(true); setFailure(null); setSaved(false);
    try { changed(await runDiligence(data.profileId)); } catch (error) { setFailure(error); } finally { setRunning(false); }
  }
  return <section className="space-y-3" aria-label={t("actions")}>
    <div className="flex flex-wrap gap-2">
      {canRun && <Button type="button" variant="outline" disabled={running || data.lastRun?.state === "waiting"} onClick={() => void run()}>{running ? t("requesting") : t("rerun")}</Button>}
      <Button ref={overrideRef} type="button" disabled={running} onClick={() => { setMode("override"); setSaved(false); }}>{t("overrideTitle")}</Button>
      <Button ref={enhancedRef} type="button" variant="outline" disabled={running || data.record === null} onClick={() => { setMode("enhanced"); setSaved(false); }}>{t("editEnhanced")}</Button>
    </div>
    {saved && <p role="status" className="text-sm text-muted-foreground">{t("saved")}</p>}
    {failure !== null && <DiligenceFailure error={failure} />}
    {mode && <DiligenceEditor key={mode} initial={data} actorId={actorId} mode={mode} finalFocus={mode === "override" ? overrideRef : enhancedRef}
      close={() => setMode(null)} saved={next => { changed(next); setMode(null); setSaved(true); }} />}
  </section>;
}
