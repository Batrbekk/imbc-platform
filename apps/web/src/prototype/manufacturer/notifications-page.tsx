// Письма производителю (раздел 8.2): результат проверки, сроки сертификатов, актуальность, запросы.
// NOT-05, NOT-06, NOT-12, NOT-13, NOT-15, NOT-16, NOT-18, NOT-32.
import type { ProfileSection } from "@imbc/contracts";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useFormat } from "@/i18n/format";

import type { ManufacturerNotification } from "../data";
import { useDictionary } from "../i18n";
import { useCommonTexts } from "../labels";
import { protoPath } from "../registry";
import { useProto } from "../store";
import { useManufacturerActions } from "./actions";
import { isSection } from "./model";
import { ManufacturerPage } from "./page";
import { screenTexts } from "./screen-texts";
import { useViewedProfile, useWithViewAs } from "./view-as";

export function NotificationsPage() {
  const t = useDictionary(screenTexts);
  const format = useFormat();
  const { profile } = useViewedProfile();
  const actions = useManufacturerActions(profile);
  const items = useProto((s) =>
    s.notifications.filter((n) => n.profileId === profile.id).sort((a, b) => b.at.localeCompare(a.at)),
  );
  const unread = items.filter((n) => !n.read).length;
  return (
    <ManufacturerPage title={t("notTitle")} description={t("notDescription", { unread: format.number(unread) })}>
      {items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{t("notEmpty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        items.map((n) => (
          <Card key={n.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {t(`not.${n.notId}`)}
                {!n.read && <Badge>{t("notUnread")}</Badge>}
              </CardTitle>
              <CardDescription>
                {format.dateTime(n.at)} · {n.recipients.map((r) => t(`notTo.${r}`)).join(", ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <NotificationBody n={n} />
              {!n.read && (
                <div>
                  <Button size="sm" variant="outline" onClick={() => actions.markRead(n.id)}>
                    {t("notMarkRead")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </ManufacturerPage>
  );
}

function NotificationBody({ n }: { n: ManufacturerNotification }) {
  const t = useDictionary(screenTexts);
  const common = useCommonTexts();
  const format = useFormat();
  const withViewAs = useWithViewAs();
  const request = useProto((s) => s.operatorRequests.find((r) => r.id === n.params.requestId));
  const p = n.params;
  switch (n.notId) {
    case "NOT-05":
      return <p className="text-sm">{p.result === "verified" ? t("notBody05Verified") : t("notBody05Returned")}</p>;
    case "NOT-06":
      return (
        <p className="text-sm">
          {p.days === "0"
            ? t("notBody06Today", { certificate: p.certificate ?? "" })
            : t("notBody06", { certificate: p.certificate ?? "", days: p.days ?? "" })}
        </p>
      );
    case "NOT-12":
      return <p className="text-sm">{t("notBody12", { date: format.date(p.dueDate) })}</p>;
    case "NOT-15":
      return <p className="text-sm">{t("notBody15")}</p>;
    case "NOT-16":
      return <p className="text-sm">{t("notBody16")}</p>;
    case "NOT-13": {
      // Письмо говорит, что спросил оператор, и не называет его (NOT-32).
      const section = isSection(p.section) ? (p.section as ProfileSection) : null;
      return (
        <div className="flex flex-col gap-2 text-sm">
          <p>{section ? t("notBody13Section", { section: common(`section.${section}`) }) : t("notBody13")}</p>
          {request && <blockquote className="border-l-2 pl-3 text-muted-foreground">{request.text}</blockquote>}
          <Link className="w-fit underline underline-offset-4" to={withViewAs(protoPath("manufacturer", "requests"))}>
            {t("notOpenRequests")}
          </Link>
        </div>
      );
    }
  }
}
