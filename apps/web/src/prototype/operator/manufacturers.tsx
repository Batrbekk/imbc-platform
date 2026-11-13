// «Мои производители»: видимые Verified профили с отметками и заметками своей организации.
// OPR-01, OPR-19, OPR-21, OPR-22, IMBC-22, UPD-04, GEN-12.
import { cn } from "cn";
import { Link, useSearchParams } from "react-router";

import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";

import { MarkStateBadge, ProtoPage, TierBadge, UpdateStatusBadge } from "../components";
import { useDictionary } from "../i18n";
import { protoPath } from "../registry";
import { profileTier, tier3ProductIds, visibleProfiles } from "../rules";
import { useProto } from "../store";
import { useOperator } from "./hooks";
import { ownOrg, worksWithOf } from "./scope";
import { texts } from "./texts";

export function ManufacturersScreen() {
  const t = useDictionary(texts);
  const format = useFormat();
  const { organizationId } = useOperator();
  const state = useProto();
  const [params, setParams] = useSearchParams();
  const onlyMarked = params.get("mine") === "1";

  const marks = ownOrg(state.worksWithMarks, organizationId);
  const visits = ownOrg(state.visitMarks, organizationId);
  const notes = ownOrg(state.operatorNotes, organizationId);

  const rows = visibleProfiles(state)
    .map((profile) => {
      const ww = worksWithOf(marks, organizationId, profile.id);
      const lastVisit = visits
        .filter((v) => v.profileId === profile.id)
        .sort((a, b) => a.visitedOn.localeCompare(b.visitedOn))
        .at(-1);
      const noteCount = notes.filter((n) => n.profileId === profile.id).length;
      return { profile, ww, lastVisit, noteCount };
    })
    .filter((row) => !onlyMarked || row.ww.history.length > 0 || row.lastVisit || row.noteCount > 0);

  return (
    <ProtoPage title={t("mfTitle")} description={t("mfDescription")}>
      <div className="flex items-center gap-2">
        <Switch
          id="operator-only-marked"
          checked={onlyMarked}
          onCheckedChange={(checked) =>
            setParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                if (checked) next.set("mine", "1");
                else next.delete("mine");
                return next;
              },
              { replace: true },
            )
          }
        />
        <Label htmlFor="operator-only-marked">{t("mfOnlyMarked")}</Label>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colCompany")}</TableHead>
              <TableHead>{t("colRegion")}</TableHead>
              <TableHead>{t("colUpdate")}</TableHead>
              <TableHead>{t("colTier")}</TableHead>
              <TableHead>{t("colTier3")}</TableHead>
              <TableHead>{t("colWorksWith")}</TableHead>
              <TableHead>{t("colVisit")}</TableHead>
              <TableHead>{t("colNotes")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ profile, ww, lastVisit, noteCount }) => (
              <TableRow key={profile.id}>
                <TableCell>
                  <div className="font-medium">{profile.nameRu}</div>
                  <div className="font-mono text-xs text-muted-foreground">{profile.bin}</div>
                </TableCell>
                <TableCell>{profile.sections.main.region}</TableCell>
                <TableCell>{profile.updateStatus && <UpdateStatusBadge status={profile.updateStatus} />}</TableCell>
                <TableCell>
                  <TierBadge tier={profileTier(state, profile)} />
                </TableCell>
                <TableCell>{format.number(tier3ProductIds(state, profile.id).length)}</TableCell>
                <TableCell>
                  {ww.history.length === 0 ? (
                    <span className="text-muted-foreground">{t("noMark")}</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1">
                      {ww.current ? t("worksWith") : t("notWorksWith")}
                      {ww.waiting && <MarkStateBadge state="waiting" />}
                      {ww.rejected && <MarkStateBadge state="rejected" />}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs">{lastVisit ? format.date(lastVisit.visitedOn) : "—"}</TableCell>
                <TableCell>{format.number(noteCount)}</TableCell>
                <TableCell>
                  <Link
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    to={protoPath("operator", `manufacturers/${profile.id}`)}
                    aria-label={`${t("open")}: ${profile.nameRu}`}
                  >
                    {t("open")}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>{t("mfEmpty")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </ProtoPage>
  );
}
