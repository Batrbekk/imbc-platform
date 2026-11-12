// Экран примера модуля (README прототипа): заметки оператора о компании. OPR-22, GEN-12 — только своя организация.
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/i18n/format";
import { ProtoPage } from "@/prototype/components";
import { localized, useDictionary } from "@/prototype/i18n";
import { accountName } from "@/prototype/rules";
import { newId, nowIso, useActor, useProto, useProtoUpdate } from "@/prototype/store";

import { texts } from "./example-texts";

const PROFILE = "p01";

export function NotesScreen() {
  const t = useDictionary(texts);
  const format = useFormat();
  const actor = useActor();
  const update = useProtoUpdate();
  const company = useProto((s) => s.profiles.find((p) => p.id === PROFILE)!);
  const notes = useProto((s) =>
    s.operatorNotes.filter((n) => n.profileId === PROFILE && n.operatorOrgId === actor.organizationId),
  );
  const state = useProto();
  const [text, setText] = useState("");

  const add = () => {
    const id = newId("opn");
    update(
      {
        action: "operator_note.create",
        subject: { type: "operator_note", id, label: company.nameRu },
        summary: localized(texts, "added"),
      },
      (draft) => {
        draft.operatorNotes.push({
          id,
          operatorOrgId: actor.organizationId,
          // Ключ демо-аккаунта: у действующего он есть всегда; почту сеанса не хранить (NFR-11).
          authorId: actor.accountId!,
          profileId: PROFILE,
          text,
          createdAt: nowIso(),
        });
      },
    );
    setText("");
  };

  return (
    <ProtoPage title={t("title", { company: company.nameRu })}>
      <ul className="flex flex-col gap-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg border p-3 text-sm">
            {n.text} — {accountName(state, n.authorId)}, {format.date(n.createdAt)}
          </li>
        ))}
      </ul>
      <Textarea aria-label={t("add")} value={text} onChange={(e) => setText(e.target.value)} />
      <div>
        <Button disabled={!text.trim()} onClick={add}>
          {t("add")}
        </Button>
      </div>
    </ProtoPage>
  );
}
