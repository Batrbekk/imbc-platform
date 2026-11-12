// Запросы операторов: входящие без названия оператора и его пользователя, один ответ на запрос.
// GEN-11, OPR-27, OPR-28, OPR-29, NOT-32.
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useFormat } from "@/i18n/format";

import { RequestThread, type ThreadEntry } from "../components";
import { useDictionary } from "../i18n";
import { useCommonTexts } from "../labels";
import { useProto } from "../store";
import { useManufacturerActions } from "./actions";
import { sectionHref } from "./model";
import { ManufacturerPage } from "./page";
import { screenTexts } from "./screen-texts";
import { useViewedProfile, useWithViewAs } from "./view-as";

export function RequestsPage() {
  const t = useDictionary(screenTexts);
  const common = useCommonTexts();
  const format = useFormat();
  const { profile } = useViewedProfile();
  const actions = useManufacturerActions(profile);
  const withViewAs = useWithViewAs();
  const requests = useProto((s) =>
    s.operatorRequests.filter((r) => r.profileId === profile.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  const open = requests.filter((r) => !r.reply).length;

  return (
    <ManufacturerPage
      title={t("reqTitle")}
      description={t("reqDescription", { open: format.number(open), total: format.number(requests.length) })}
    >
      {requests.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{t("reqEmpty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        requests.map((r) => {
          // Оператор, его организация и пользователь производителю не называются (GEN-11, OPR-28).
          const entries: ThreadEntry[] = [
            { id: `${r.id}-ask`, author: t("reqAnOperator"), at: r.createdAt, text: r.text },
          ];
          if (r.reply)
            entries.push({ id: `${r.id}-reply`, author: profile.nameRu, at: r.reply.at, text: r.reply.text });
          return (
            <Card key={r.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {r.section ? t("reqAboutSection", { section: common(`section.${r.section}`) }) : t("reqFreeText")}
                  <Badge variant={r.reply ? "secondary" : "outline"}>{common(`request.${r.status}`)}</Badge>
                </CardTitle>
                <CardDescription>{t("reqReceived", { date: format.dateTime(r.createdAt) })}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {r.section && (
                  <Link className="w-fit text-sm underline underline-offset-4" to={withViewAs(sectionHref(r.section))}>
                    {t("reqOpenSection", { section: common(`section.${r.section}`) })}
                  </Link>
                )}
                <RequestThread
                  entries={entries}
                  onReply={r.reply ? undefined : (text) => actions.reply(r.id, text)}
                  replyLabel={t("reqReply")}
                  placeholder={t("reqReplyPlaceholder")}
                />
                {!r.reply && <p className="text-xs text-muted-foreground">{t("reqOneReply")}</p>}
              </CardContent>
            </Card>
          );
        })
      )}
    </ManufacturerPage>
  );
}
