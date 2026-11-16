import { can } from "@imbc/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { ArrowLeftIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";
import { PageTitle } from "@/components/app/page-title";
import { Button, buttonVariants } from "@/components/ui/button";
import { DiligenceActions } from "@/features/diligence/actions";
import { readDiligence } from "@/features/diligence/api";
import { DiligenceChecks } from "@/features/diligence/checks";
import { DiligenceFailure } from "@/features/diligence/feedback";
import { DiligenceHistory } from "@/features/diligence/history";
import { DiligenceRecord } from "@/features/diligence/record";
import { useMe } from "@/lib/session";

export function DiligencePage() {
  const t = useTranslations("diligence"), me = useMe(), { profileId = "" } = useParams(), cache = useQueryClient();
  const from: unknown = (useLocation().state as { from?: unknown } | null)?.from;
  const role = me.data?.user.role, actorId = me.data?.user.id;
  const allowed = role !== undefined && ["expert", "director"].includes(role) && can(role, "imbc_records.read") !== null;
  const valid = z.uuid().safeParse(profileId).success;
  const queryKey = ["diligence", actorId, profileId, "current"];
  const query = useQuery({ queryKey, queryFn: () => readDiligence(profileId), enabled: allowed && valid,
    staleTime: 0, gcTime: 0, refetchInterval: state => state.state.data?.lastRun?.state === "waiting" ? 3000 : false,
  });
  const [history, setHistory] = useState(false), historyRef = useRef<HTMLButtonElement>(null);
  const back = typeof from === "string" && (from === "/reviews" || from.startsWith("/reviews?") || from === `/companies/${profileId}`) ? from : role === "expert" ? "/reviews" : "/catalog";
  return <div className="mx-auto flex min-w-0 max-w-5xl flex-col gap-5">
    <PageTitle title={t("title")} /><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
    <div><Link to={back} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}><ArrowLeftIcon />{t("back")}</Link></div>
    {me.isPending ? <p role="status">{t("loading")}</p> : !allowed ? <p role="alert" className="text-destructive">{t("errors.forbidden")}</p> : !valid ? <p role="alert">{t("errors.notFound")}</p> : query.isError ? <DiligenceFailure error={query.error} retry={() => void query.refetch()} /> : query.isPending ? <p role="status">{t("loading")}</p> : query.data && <>
      <DiligenceRecord data={query.data} />
      <div className="flex flex-wrap gap-3"><Button ref={historyRef} type="button" variant="outline" onClick={() => setHistory(true)}>{t("history")}</Button></div>
      {role === "expert" && can(role, "imbc_records.edit") !== null && actorId && <DiligenceActions data={query.data} actorId={actorId} canRun={can(role, "external_checks.run") !== null}
        changed={data => { cache.setQueryData(queryKey, data); void cache.invalidateQueries({ queryKey: ["diligence", actorId, profileId, "history"] }); }} />}
      <DiligenceChecks checks={query.data.checks} />
      {history && actorId && <DiligenceHistory profileId={profileId} actorId={actorId} close={() => setHistory(false)} finalFocus={historyRef} />}
    </>}
  </div>;
}
