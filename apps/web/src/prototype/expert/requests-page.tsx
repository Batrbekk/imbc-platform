// Запросы для SME: IMBC requests — отправитель, организация, тема, сообщение, связанный производитель, ответ
// текстом и закрытие (IMBC-17, OPR-25, NOT-33); operator requests с ответом производителя и статусом (IMBC-18,
// OPR-27, OPR-30); заметки операторов всех организаций (OPR-22). Вкладка и выбранный запрос — в адресе.
import { Link, useSearchParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFormat } from "@/i18n/format";
import { ConfirmAction, ProtoPage, RequestThread } from "@/prototype/components";
import type { ImbcRequest } from "@/prototype/data";
import { localized, useDictionary } from "@/prototype/i18n";
import { useCommonTexts } from "@/prototype/labels";
import { accountName, organizationName, profileById } from "@/prototype/rules";
import { newId, nowIso, useProto, useProtoUpdate } from "@/prototype/store";

import { useExpertId } from "./actor";
import { dossierPath } from "./paths";
import { texts } from "./texts";

const TABS = ["imbc", "operator", "notes"] as const;
type Tab = (typeof TABS)[number];

export function RequestsScreen() {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const format = useFormat();
  const state = useProto();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = (TABS as readonly (string | null)[]).includes(raw) ? (raw as Tab) : "imbc";
  const setParam = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const imbc = [...state.imbcRequests].sort(
    (a, b) => Number(b.status === "open") - Number(a.status === "open") || b.createdAt.localeCompare(a.createdAt),
  );
  const selected = imbc.find((r) => r.id === params.get("id")) ?? imbc[0];
  const operatorRequests = [...state.operatorRequests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const notes = [...state.operatorNotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const company = (id: string | null) => (id ? (profileById(state, id)?.nameRu ?? id) : null);
  const openCount = imbc.filter((r) => r.status === "open").length;

  return (
    <ProtoPage title={t("requestsTitle")} description={t("requestsHint")}>
      <Tabs value={tab} onValueChange={(v) => setParam("tab", v === "imbc" ? null : String(v))}>
        <div className="max-w-full overflow-x-auto pb-1">
          <TabsList>
            <TabsTrigger value="imbc">{t("tabImbc", { count: format.number(openCount) })}</TabsTrigger>
            <TabsTrigger value="operator">{t("tabOperator")}</TabsTrigger>
            <TabsTrigger value="notes">{t("tabNotes")}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="imbc">
          {imbc.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("imbcEmpty")}</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
              <ul className="flex flex-col gap-2">
                {imbc.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      aria-current={selected?.id === r.id ? "true" : undefined}
                      className="flex w-full flex-col gap-1 rounded-lg border p-3 text-left text-sm hover:bg-muted/50 aria-[current=true]:border-primary"
                      onClick={() => setParam("id", r.id)}
                    >
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{r.subject}</span>
                        <Badge variant={r.status === "open" ? "secondary" : "outline"}>
                          {common(`request.${r.status}`)}
                        </Badge>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {organizationName(state, r.operatorOrgId)} · {format.date(r.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {selected && <ImbcRequestCard request={selected} company={company(selected.profileId)} />}
            </div>
          )}
        </TabsContent>

        <TabsContent value="operator">
          <p className="mb-2 text-xs text-muted-foreground">{t("operatorRequestsHint")}</p>
          {operatorRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("operatorRequestsEmpty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("manufacturer")}</TableHead>
                    <TableHead>{t("operator")}</TableHead>
                    <TableHead>{t("ask")}</TableHead>
                    <TableHead>{t("reply")}</TableHead>
                    <TableHead>{t("state")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operatorRequests.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link className="underline-offset-4 hover:underline" to={dossierPath(r.profileId, "operators")}>
                          {company(r.profileId)}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {organizationName(state, r.operatorOrgId)}
                        <div className="text-xs text-muted-foreground">
                          {accountName(state, r.senderId)} · {format.date(r.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {r.section && <Badge variant="outline">{common(`section.${r.section}`)}</Badge>} {r.text}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {r.reply ? (
                          <>
                            {r.reply.text}
                            <div className="text-xs text-muted-foreground">{format.date(r.reply.at)}</div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">{t("noReply")}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.status === "open" ? "secondary" : "outline"}>
                          {common(`request.${r.status}`)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="notes">
          <p className="mb-2 text-xs text-muted-foreground">{t("operatorNotesHint")}</p>
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("operatorNotesEmpty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("manufacturer")}</TableHead>
                    <TableHead>{t("operator")}</TableHead>
                    <TableHead>{t("note")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notes.map((n) => (
                    <TableRow key={n.id}>
                      <TableCell>{company(n.profileId)}</TableCell>
                      <TableCell className="whitespace-normal">
                        {organizationName(state, n.operatorOrgId)}
                        <div className="text-xs text-muted-foreground">
                          {accountName(state, n.authorId)} · {format.date(n.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal">{n.text}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </ProtoPage>
  );
}

function ImbcRequestCard({ request, company }: { request: ImbcRequest; company: string | null }) {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const me = useExpertId();
  const update = useProtoUpdate();
  const state = useProto();
  const subject = { type: "imbc_request" as const, id: request.id, label: request.subject };
  const reply = (text: string) =>
    update({ action: "imbc_request.reply", subject, summary: localized(texts, "auditRequestReply") }, (draft) => {
      draft.imbcRequests
        .find((r) => r.id === request.id)!
        .messages.push({ id: newId("msg"), authorId: me, at: nowIso(), text });
    });
  const close = () =>
    update({ action: "imbc_request.close", subject, summary: localized(texts, "auditRequestClose") }, (draft) => {
      draft.imbcRequests.find((r) => r.id === request.id)!.status = "closed";
    });
  const entries = request.messages.map((m) => {
    const author = state.accounts.find((a) => a.id === m.authorId);
    return {
      id: m.id,
      author: accountName(state, m.authorId),
      meta:
        author?.role === "operator"
          ? organizationName(state, author.organizationId)
          : common(`role.${author?.role ?? "expert"}`),
      at: m.at,
      text: m.text,
    };
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{request.subject}</CardTitle>
        <CardDescription className="flex flex-col gap-1">
          <span>
            {t("requestFrom", {
              name: accountName(state, request.senderId),
              organization: organizationName(state, request.operatorOrgId),
            })}
          </span>
          <span>
            {request.profileId && company ? (
              <Link className="underline underline-offset-4" to={dossierPath(request.profileId)}>
                {t("linkedManufacturer", { name: company })}
              </Link>
            ) : (
              t("noLinkedManufacturer")
            )}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <RequestThread
          entries={entries}
          onReply={request.status === "open" ? reply : undefined}
          replyLabel={t("sendReply")}
        />
        <p className="text-xs text-muted-foreground">{t("replyHint")}</p>
        {request.status === "open" ? (
          <div>
            <ConfirmAction
              variant="outline"
              label={t("closeRequest")}
              title={t("closeRequestTitle")}
              description={t("closeRequestHint")}
              confirmLabel={t("closeRequest")}
              onConfirm={close}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("requestClosed")}</p>
        )}
      </CardContent>
    </Card>
  );
}
