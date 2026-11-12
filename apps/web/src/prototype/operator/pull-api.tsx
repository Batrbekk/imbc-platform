// Pull API: учётные данные своей организации (выдаёт и отзывает администратор) и пример запроса.
// OPR-36, OPR-37, OPR-38, ADM-07, DATA-13, DATA-14, GEN-12.
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormat } from "@/i18n/format";

import { ProtoPage } from "../components";
import type { ProtoProfile, ProtoState } from "../data";
import { useDictionary } from "../i18n";
import { accountName, isSiteSurveyed, profileTier, tier3ProductIds, visibleProfiles, worksWithCount } from "../rules";
import { useProto } from "../store";
import { useOperator } from "./hooks";
import { Row } from "./parts";
import { majorOperatorCount, ownOrg } from "./scope";
import { texts } from "./texts";

/**
 * Пример записи ответа: поля страницы компании (DATA-14). Нет заметок операторов, итога и находок
 * due diligence, названий операторов, ожидающих значений, ответа «Откуда вы узнали о нас?» (DATA-13).
 */
function sampleRecord(state: ProtoState, p: ProtoProfile) {
  const { main, contacts, products, certificates } = p.sections;
  const focal = contacts.find((c) => c.focalPoint);
  const dd = state.dueDiligence.find((d) => d.profileId === p.id);
  const tier3 = new Set(tier3ProductIds(state, p.id));
  return {
    bin: p.bin,
    nameEn: p.nameEn,
    nameRu: p.nameRu,
    region: main.region,
    website: main.website,
    companyEmail: main.contactEmail,
    companyPhone: main.companyPhone,
    focalPoint: focal
      ? { name: focal.fullName, position: focal.position, email: focal.email, phone: focal.phone }
      : null,
    registeredAt: p.registeredAt,
    verifiedAt: p.verifiedAt,
    updateStatus: p.updateStatus,
    tier: profileTier(state, p),
    siteSurveyed: isSiteSurveyed(state, p.id),
    dueDiligenceCheckedAt: dd?.checkedAt ?? null,
    enhancedDueDiligence: dd?.enhanced.done ?? false,
    worksWithMajorOperators: { count: worksWithCount(state, p.id), of: majorOperatorCount(state) },
    pendingChanges: p.pendingChanges,
    productLines: products.map((line) => ({
      name: line.nameEn,
      group: line.group,
      tnved: line.tnved,
      kpved: line.kpved,
      tier3: tier3.has(line.id),
      icvPct: line.icvPct,
      localization: line.localization,
      eOndiris: line.registry,
    })),
    certificates: certificates
      .filter((c) => c.status === "verified")
      .map((c) => ({ type: c.type, number: c.number, expiresOn: c.expiresOn })),
  };
}

export function PullApiScreen() {
  const t = useDictionary(texts);
  const format = useFormat();
  const state = useProto();
  const { organizationId } = useOperator();
  const credentials = ownOrg(state.apiCredentials, organizationId).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const active = credentials.find((c) => c.revokedAt === null);
  const first = visibleProfiles(state)[0];
  const request = [
    `curl -u "${active?.clientId ?? "<client-id>"}:${active?.secretSample ?? "<key>"}" \\`,
    `  "https://imbc.example/pull/v1/manufacturers?page=1"`,
  ].join("\n");

  return (
    <ProtoPage title={t("apiTitle")} description={t("apiHint")}>
      <Card>
        <CardHeader>
          <CardTitle>{t("credentials")}</CardTitle>
          <CardDescription>{t("sampleNote")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {credentials.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noCreds")}</p>
          ) : (
            credentials.map((c) => (
              <dl key={c.id} className="grid gap-3 rounded-lg border p-3 text-sm">
                <Row label={t("clientId")}>
                  <span className="flex flex-wrap items-center gap-2">
                    <code className="font-mono break-all">{c.clientId}</code>
                    <Badge variant={c.revokedAt ? "outline" : "secondary"}>
                      {c.revokedAt ? t("credRevoked") : t("credActive")}
                    </Badge>
                  </span>
                </Row>
                {!c.revokedAt && (
                  <Row label={t("secret")}>
                    <code className="font-mono break-all">{c.secretSample}</code>
                  </Row>
                )}
                <Row label={t("issued")}>
                  {format.dateTime(c.issuedAt)} · {accountName(state, c.issuedBy)}
                </Row>
                {c.revokedAt && (
                  <Row label={t("revoked")}>
                    {format.dateTime(c.revokedAt)} · {accountName(state, c.revokedBy)}
                  </Row>
                )}
              </dl>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("example")}</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{request}</pre>
        </CardContent>
      </Card>

      {first && (
        <Card>
          <CardHeader>
            <CardTitle>{t("exampleResponse")}</CardTitle>
            <CardDescription>{t("exampleHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <pre aria-label={t("exampleResponse")} className="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs">
              {JSON.stringify(
                { items: [sampleRecord(state, first)], page: 1, total: visibleProfiles(state).length },
                null,
                2,
              )}
            </pre>
          </CardContent>
        </Card>
      )}
    </ProtoPage>
  );
}
