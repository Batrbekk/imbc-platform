// Справочники, образец оргструктуры и версии NDA для генерального директора IMBC — только просмотр (GEN-04,
// раздел 4: «view»): ADM-08, ADM-09, ADM-10, ADM-11, принятия NDA (FC-02, FC-03). Части экрана — из кабинета
// администратора с `readOnly`. Выбранный справочник — в адресе.
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { ProtoPage } from "@/prototype/components";
import { NdaVersionsView, OrgChartSampleView, ReferenceListView, sharedTexts } from "@/prototype/administrator/shared";
import { useDictionary } from "@/prototype/i18n";
import { accountName, currentNda } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import { FilterSelect } from "./filter-select";
import { dossierPath, pick, useAddress } from "./paths";
import { libraryTexts } from "./library-texts";

export function ReferencesScreen() {
  const t = useDictionary(libraryTexts);
  const shared = useDictionary(sharedTexts);
  const format = useFormat();
  const state = useProto();
  const { params, set } = useAddress();

  const ids = state.referenceLists.map((l) => l.id);
  const first = ids[0] ?? "regions";
  const listId = pick(ids, params.get("list"), first);
  const list = state.referenceLists.find((l) => l.id === listId);
  const current = currentNda(state);
  // Профиль без поля `nda` (другая форма сохранённых данных) в список не попадает.
  const acceptances = state.profiles
    .flatMap((p) => (p.nda != null && typeof p.nda.at === "string" ? [{ p, nda: p.nda }] : []))
    .sort((a, b) => b.nda.at.localeCompare(a.nda.at));

  return (
    <ProtoPage hideReset title={t("referencesTitle")} description={t("referencesHint")}>
      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle")}</CardTitle>
          <div>
            <FilterSelect
              label={t("list")}
              value={listId}
              items={ids.map((id) => ({ value: id, label: shared(`list.${id}`) }))}
              onChange={(v) => set("list", v, first)}
            />
          </div>
        </CardHeader>
        <CardContent>{list && <ReferenceListView list={list} readOnly />}</CardContent>
      </Card>

      <OrgChartSampleView file={state.orgChartSample} readOnly />

      <Card>
        <CardHeader>
          <CardTitle>{t("ndaTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <NdaVersionsView
            versions={state.ndaVersions}
            currentId={current.id}
            accountName={(id) => accountName(state, id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("acceptancesTitle")}</CardTitle>
          <CardDescription>{t("acceptancesHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {acceptances.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("acceptancesEmpty")}</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("manufacturer")}</TableHead>
                    <TableHead>{t("version")}</TableHead>
                    <TableHead>{t("acceptedAt")}</TableHead>
                    <TableHead>{t("ip")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {acceptances.map(({ p, nda }) => {
                    const version = state.ndaVersions.find((v) => v.id === nda.versionId);
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-normal">
                          <Link className="underline-offset-4 hover:underline" to={dossierPath(p.id)}>
                            {p.nameRu}
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <span className="inline-flex flex-wrap items-center gap-2">
                            NDA {version?.version ?? nda.versionId}
                            {nda.versionId === current.id ? (
                              <Badge variant="secondary">{t("current")}</Badge>
                            ) : (
                              <>
                                <Badge variant="outline">{t("earlier")}</Badge>
                                <span className="text-xs text-muted-foreground">{t("earlierHint")}</span>
                              </>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>{format.dateTime(nda.at)}</TableCell>
                        <TableCell className="font-mono text-xs">{nda.ip}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </ProtoPage>
  );
}
