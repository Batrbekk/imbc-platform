// Справочники администратора: ADM-08, ADM-09, ADM-11, DATA-04.
import type { Locale } from "@imbc/contracts";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmAction, ProtoPage } from "@/prototype/components";
import type { ReferenceItem, ReferenceList, ReferenceListId } from "@/prototype/data";
import { useDictionary } from "@/prototype/i18n";
import { useProto } from "@/prototype/store";

import { useGuardedUpdate } from "./actor";
import { TextField } from "./fields";
import { referencesTexts } from "./references-texts";
import { hasMandatoryMark, OrgChartSampleView, ReferenceListView, sharedTexts } from "./shared";
import { localizedWith } from "./texts";

export function ReferencesScreen() {
  const t = useDictionary(referencesTexts);
  const shared = useDictionary(sharedTexts);
  const update = useGuardedUpdate();
  const lists = useProto((s) => s.referenceLists);
  const sample = useProto((s) => s.orgChartSample);
  const [params, setParams] = useSearchParams();
  const list =
    lists.find((l) => l.id === params.get("list")) ?? lists.find((l) => l.id === "certificate_types") ?? lists[0];
  const listName = (id: ReferenceListId) => (l: Locale) => sharedTexts[l][`list.${id}`];

  const changeItem = (
    list: ReferenceList,
    item: ReferenceItem,
    key: "madeMandatory" | "madeOptional" | "retiredItem" | "restoredItem",
    change: (target: ReferenceItem) => void,
  ) =>
    update(
      {
        action: key === "madeMandatory" || key === "madeOptional" ? "reference.mandatory" : "reference.retire",
        subject: { type: "reference", id: `${list.id}:${item.code}`, label: item.label },
        summary: localizedWith(referencesTexts, key, (l) => ({ item: item.label, list: listName(list.id)(l) })),
      },
      (draft) => {
        const target = draft.referenceLists.find((l) => l.id === list.id)?.items.find((i) => i.code === item.code);
        if (!target) return false;
        change(target);
        return true;
      },
    );

  const items = lists.map((l) => ({ value: l.id, label: shared(`list.${l.id}`) }));

  return (
    <ProtoPage title={t("title")} description={t("description")}>
      {list ? (
        <Card>
          <CardHeader>
            <CardTitle>{shared(`list.${list.id}`)}</CardTitle>
            <CardAction className="flex flex-wrap gap-2">
              <Select
                items={items}
                value={list.id}
                onValueChange={(value) => {
                  if (typeof value === "string") setParams({ list: value }, { replace: true });
                }}
              >
                <SelectTrigger aria-label={t("list")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} align="end" className="w-auto min-w-(--anchor-width)">
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <AddValue list={list} name={shared(`list.${list.id}`)} />
            </CardAction>
          </CardHeader>
          <CardContent>
            <ReferenceListView
              list={list}
              readOnly={false}
              onMandatoryChange={(item, mandatory) =>
                changeItem(list, item, mandatory ? "madeMandatory" : "madeOptional", (target) => {
                  target.mandatory = mandatory;
                })
              }
              onRetiredChange={(item, retired) =>
                changeItem(list, item, retired ? "retiredItem" : "restoredItem", (target) => {
                  target.retired = retired;
                })
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{t("noLists")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <OrgChartSampleView
        file={sample}
        readOnly={false}
        onReplace={(file) =>
          update(
            {
              action: "reference.org_chart_sample",
              subject: { type: "reference", id: "org_chart_sample", label: file.name },
              summary: localizedWith(referencesTexts, "orgChartReplaced", () => ({ file: file.name })),
            },
            (draft) => {
              draft.orgChartSample = file;
              return true;
            },
          )
        }
      />
    </ProtoPage>
  );
}

function AddValue({ list, name }: { list: ReferenceList; name: string }) {
  const t = useDictionary(referencesTexts);
  const update = useGuardedUpdate();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const taken = list.items.some((i) => i.code.toLowerCase() === code.trim().toLowerCase());
  const mandatoryMark = hasMandatoryMark(list);

  const add = () => {
    const item: ReferenceItem = {
      code: code.trim(),
      label: label.trim(),
      retired: false,
      ...(mandatoryMark ? { mandatory: false } : {}),
    };
    update(
      {
        action: "reference.add",
        subject: { type: "reference", id: `${list.id}:${item.code}`, label: item.label },
        summary: localizedWith(referencesTexts, "added", (l) => ({
          code: item.code,
          list: sharedTexts[l][`list.${list.id}`],
        })),
      },
      (draft) => {
        const target = draft.referenceLists.find((l) => l.id === list.id);
        if (!target || target.items.some((i) => i.code.toLowerCase() === item.code.toLowerCase())) return false;
        target.items.push(item);
        return true;
      },
    );
    setCode("");
    setLabel("");
  };

  return (
    <ConfirmAction
      variant="outline"
      label={t("add")}
      title={t("addTitle", { list: name })}
      confirmLabel={t("add")}
      confirmDisabled={!code.trim() || !label.trim() || taken}
      onConfirm={add}
    >
      <div className="flex flex-col gap-4">
        <TextField label={t("code")} value={code} onChange={setCode} error={taken ? t("codeTaken") : null} />
        <TextField label={t("label")} value={label} onChange={setLabel} />
      </div>
    </ConfirmAction>
  );
}
