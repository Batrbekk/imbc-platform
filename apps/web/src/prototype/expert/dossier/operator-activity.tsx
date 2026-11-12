// Что операторы оставили по профилю — для IMBC (SME и директор): кто работает с производителем (IMBC-16),
// отметки визитов (IMBC-04), заметки всех операторов (OPR-22), operator requests с ответом (IMBC-18). Только показ.
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { MarkStateBadge } from "@/prototype/components";
import { useDictionary } from "@/prototype/i18n";
import { useCommonTexts } from "@/prototype/labels";
import { accountName, organizationName, worksWithCount } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import { worksWithOrganizations } from "./helpers";
import { dossierTexts } from "./texts";

export function OperatorActivity({ profileId }: { profileId: string }) {
  const t = useDictionary(dossierTexts);
  const common = useCommonTexts();
  const format = useFormat();
  const state = useProto();
  const marks = state.worksWithMarks
    .filter((m) => m.profileId === profileId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visits = state.visitMarks.filter((v) => v.profileId === profileId);
  const notes = state.operatorNotes
    .filter((n) => n.profileId === profileId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const requests = state.operatorRequests
    .filter((r) => r.profileId === profileId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const working = worksWithOrganizations(state, profileId);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("worksWithTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>
            {working.length === 0
              ? t("worksWithNone")
              : t("worksWithList", {
                  names: working.map((id) => organizationName(state, id)).join(", "),
                  count: format.number(worksWithCount(state, profileId)),
                })}
          </p>
          {marks.length === 0 ? (
            <p className="text-muted-foreground">{t("marksEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {marks.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
                  <span>
                    {organizationName(state, m.operatorOrgId)} · {m.value ? t("markSet") : t("markRemoved")} ·{" "}
                    {format.date(m.createdAt)}
                  </span>
                  <MarkStateBadge state={m.state} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("visitsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {visits.length === 0 ? (
            <p className="text-muted-foreground">{t("visitsEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visits.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
                  <span>
                    {organizationName(state, v.operatorOrgId)} · {format.date(v.visitedOn)}
                  </span>
                  <Badge variant="outline">{t(`visit.${v.decision}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("operatorNotesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {notes.length === 0 ? (
            <p className="text-muted-foreground">{t("operatorNotesEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {notes.map((n) => (
                <li key={n.id} className="flex flex-col gap-1 rounded-lg border p-2">
                  <span className="text-xs text-muted-foreground">
                    {organizationName(state, n.operatorOrgId)} · {accountName(state, n.authorId)} ·{" "}
                    {format.dateTime(n.createdAt)}
                  </span>
                  <p>{n.text}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("operatorRequestsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {requests.length === 0 ? (
            <p className="text-muted-foreground">{t("operatorRequestsEmpty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("operator")}</TableHead>
                    <TableHead>{t("requestAsk")}</TableHead>
                    <TableHead>{t("requestReply")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-normal">
                        {organizationName(state, r.operatorOrgId)}
                        <div className="text-xs text-muted-foreground">{accountName(state, r.senderId)}</div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {r.section && <Badge variant="outline">{common(`section.${r.section}`)}</Badge>} {r.text}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <Badge variant={r.status === "open" ? "secondary" : "outline"}>
                          {common(`request.${r.status}`)}
                        </Badge>{" "}
                        {r.reply?.text ?? t("noReply")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
