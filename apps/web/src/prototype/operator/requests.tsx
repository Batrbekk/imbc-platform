// Запросы оператора: IMBC request с перепиской и operator request производителю с одним ответом.
// OPR-25, OPR-26, OPR-27, OPR-28, OPR-29, NOT-32, NOT-33, GEN-12.
import { PROFILE_SECTIONS, type ProfileSection } from "@imbc/contracts";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/i18n/format";

import { ProtoPage, RequestThread, type ThreadEntry } from "../components";
import type { ProtoState } from "../data";
import { ORG } from "../data/organizations";
import { localized, useDictionary } from "../i18n";
import { useCommonTexts } from "../labels";
import { accountName, organizationName, profileById, visibleProfiles } from "../rules";
import { newId, nowIso, useProto, useProtoUpdate } from "../store";
import { useOperator } from "./hooks";
import { Choice } from "./parts";
import { ownOrg, visibleProfile } from "./scope";
import { texts } from "./texts";

const NONE = "none";
type Tab = "imbc" | "operator";

export function RequestsScreen() {
  const t = useDictionary(texts);
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "operator" ? "operator" : "imbc";
  const state = useProto();
  // Предвыбор компании из карточки (`?profile=`) — только видимой (NOT-32).
  const preset = visibleProfile(state, params.get("profile"))?.id ?? null;

  return (
    <ProtoPage title={t("reqTitle")}>
      <Tabs
        value={tab}
        onValueChange={(value) =>
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.set("tab", String(value));
              return next;
            },
            { replace: true },
          )
        }
      >
        <TabsList>
          <TabsTrigger value="imbc">{t("tabImbc")}</TabsTrigger>
          <TabsTrigger value="operator">{t("tabOperator")}</TabsTrigger>
        </TabsList>
        <TabsContent value="imbc" className="flex flex-col gap-4 pt-2">
          <ImbcRequests preset={preset} />
        </TabsContent>
        <TabsContent value="operator" className="flex flex-col gap-4 pt-2">
          <OperatorRequests preset={preset} />
        </TabsContent>
      </Tabs>
    </ProtoPage>
  );
}

function useCompanyItems(noneLabel?: string) {
  const state = useProto();
  const items = visibleProfiles(state).map((p) => ({ value: p.id, label: p.nameRu }));
  return noneLabel ? [{ value: NONE, label: noneLabel }, ...items] : items;
}

/** Подпись под именем автора: IMBC или организация оператора; производителю этот экран не виден. */
function authorMeta(state: ProtoState, accountId: string): string | undefined {
  const orgId = state.accounts.find((a) => a.id === accountId)?.organizationId;
  return orgId === ORG.imbc ? "IMBC" : orgId ? organizationName(state, orgId) : undefined;
}

function ImbcRequests({ preset }: { preset: string | null }) {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const format = useFormat();
  const state = useProto();
  const update = useProtoUpdate();
  const { organizationId, accountId } = useOperator();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [linked, setLinked] = useState(preset ?? NONE);
  const companies = useCompanyItems(t("notLinked"));
  const requests = ownOrg(state.imbcRequests, organizationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const send = () => {
    const id = newId("ir");
    const at = nowIso();
    const profileId = linked === NONE ? null : linked;
    update(
      {
        action: "imbc_request.create",
        subject: { type: "imbc_request", id, label: subject.trim() },
        summary: localized(texts, "auditImbcCreate"),
      },
      (draft) => {
        draft.imbcRequests.push({
          id,
          operatorOrgId: organizationId,
          senderId: accountId,
          subject: subject.trim(),
          profileId,
          status: "open",
          createdAt: at,
          messages: [{ id: `${id}-m1`, authorId: accountId, at, text: message.trim() }],
        });
      },
    );
    setSubject("");
    setMessage("");
    setLinked(NONE);
  };

  const reply = (requestId: string, label: string, text: string) =>
    update(
      {
        action: "imbc_request.reply",
        subject: { type: "imbc_request", id: requestId, label },
        summary: localized(texts, "auditImbcReply"),
      },
      (draft) => {
        draft.imbcRequests
          .find((r) => r.id === requestId)
          ?.messages.push({ id: newId("irm"), authorId: accountId, at: nowIso(), text });
      },
    );

  return (
    <>
      <p className="text-sm text-muted-foreground">{t("imbcHint")}</p>
      <Card>
        <CardHeader>
          <CardTitle>{t("newImbc")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="imbc-subject">{t("subject")}</Label>
            <Input id="imbc-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="imbc-message">{t("message")}</Label>
            <Textarea id="imbc-message" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <Choice id="imbc-linked" label={t("linked")} value={linked} items={companies} onChange={setLinked} />
          <div>
            <Button disabled={!subject.trim() || !message.trim()} onClick={send}>
              {t("send")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("imbcEmpty")}</p>
      ) : (
        requests.map((r) => {
          const entries: ThreadEntry[] = r.messages.map((m) => ({
            id: m.id,
            author: accountName(state, m.authorId),
            meta: authorMeta(state, m.authorId),
            at: m.at,
            text: m.text,
          }));
          const imbcAnswered = r.messages.some((m) => authorMeta(state, m.authorId) === "IMBC");
          const company = r.profileId ? profileById(state, r.profileId)?.nameRu : null;
          return (
            <Card key={r.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {r.subject}
                  <Badge variant={r.status === "open" ? "outline" : "secondary"}>{common(`request.${r.status}`)}</Badge>
                </CardTitle>
                <CardDescription>
                  {t("sentBy", { name: accountName(state, r.senderId), date: format.dateTime(r.createdAt) })}
                  {company && ` · ${company}`}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {!imbcAnswered && <p className="text-sm text-muted-foreground">{t("waitingImbc")}</p>}
                <RequestThread
                  entries={entries}
                  replyLabel={t("continueThread")}
                  onReply={r.status === "open" ? (text) => reply(r.id, r.subject, text) : undefined}
                />
              </CardContent>
            </Card>
          );
        })
      )}
    </>
  );
}

function OperatorRequests({ preset }: { preset: string | null }) {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const format = useFormat();
  const state = useProto();
  const update = useProtoUpdate();
  const { organizationId, accountId } = useOperator();
  const [profileId, setProfileId] = useState(preset ?? NONE);
  const [section, setSection] = useState<string>(NONE);
  const [text, setText] = useState("");
  const companies = [{ value: NONE, label: t("chooseManufacturer") }, ...useCompanyItems()];
  const sections = [
    { value: NONE, label: t("sectionNone") },
    ...PROFILE_SECTIONS.map((s) => ({ value: s, label: common(`section.${s}`) })),
  ];
  const requests = ownOrg(state.operatorRequests, organizationId).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const target = visibleProfile(state, profileId === NONE ? null : profileId);
  // Секция или свободный текст (OPR-27).
  const ready = Boolean(target) && (section !== NONE || text.trim() !== "");

  const send = () => {
    if (!target) return;
    const id = newId("or");
    update(
      {
        action: "operator_request.create",
        subject: { type: "operator_request", id, label: target.nameRu },
        summary: localized(texts, "auditOpCreate"),
      },
      (draft) => {
        draft.operatorRequests.push({
          id,
          operatorOrgId: organizationId,
          senderId: accountId,
          profileId: target.id,
          section: section === NONE ? null : (section as ProfileSection),
          text: text.trim(),
          createdAt: nowIso(),
          reply: null,
          status: "open",
        });
      },
    );
    setSection(NONE);
    setText("");
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">{t("opHint")}</p>
      <Card>
        <CardHeader>
          <CardTitle>{t("newOp")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Choice
            id="op-company"
            label={t("manufacturer")}
            value={profileId}
            items={companies}
            onChange={setProfileId}
          />
          <Choice id="op-section" label={t("section")} value={section} items={sections} onChange={setSection} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="op-text">{t("ask")}</Label>
            <Textarea id="op-text" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div>
            <Button disabled={!ready} onClick={send}>
              {t("send")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("opEmpty")}</p>
      ) : (
        requests.map((r) => {
          const profile = profileById(state, r.profileId);
          return (
            <Card key={r.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {profile?.nameRu ?? "—"}
                  <Badge variant={r.status === "open" ? "outline" : "secondary"}>{common(`request.${r.status}`)}</Badge>
                </CardTitle>
                <CardDescription>
                  {t("sentBy", { name: accountName(state, r.senderId), date: format.dateTime(r.createdAt) })}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {r.section && (
                  <p className="text-muted-foreground">{t("sectionOf", { section: common(`section.${r.section}`) })}</p>
                )}
                {r.text && <p className="whitespace-pre-wrap">{r.text}</p>}
                <div className="flex flex-col gap-1 rounded-lg border p-3">
                  <span className="font-medium">{t("manufacturerReply")}</span>
                  {r.reply ? (
                    <>
                      <span className="text-xs text-muted-foreground">
                        {profile ? organizationName(state, profile.organizationId) : "—"} ·{" "}
                        {format.dateTime(r.reply.at)}
                      </span>
                      <p className="whitespace-pre-wrap">{r.reply.text}</p>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{t("noReply")}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </>
  );
}
