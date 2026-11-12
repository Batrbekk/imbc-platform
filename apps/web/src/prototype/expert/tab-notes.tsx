// Внутренние заметки IMBC по профилю: свободный текст с автором и датой и поля из Excel; видят только SME
// и генеральный директор IMBC (IMBC-15, MIG-09).
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { ProtoProfile } from "@/prototype/data";
import { localized, useDictionary } from "@/prototype/i18n";
import { newId, nowIso, useProto, useProtoUpdate } from "@/prototype/store";

import { useExpertId } from "./actor";
import { ImbcNotesList } from "./dossier";
import { texts } from "./texts";

export function NotesTab({ profile }: { profile: ProtoProfile }) {
  const t = useDictionary(texts);
  const me = useExpertId();
  const update = useProtoUpdate();
  const notes = useProto((s) => s.imbcNotes.filter((n) => n.profileId === profile.id));
  const [text, setText] = useState("");
  const add = () => {
    const id = newId("note");
    update(
      {
        action: "imbc_note.create",
        subject: { type: "imbc_note", id, label: profile.nameRu },
        summary: localized(texts, "auditNote"),
      },
      (draft) => {
        draft.imbcNotes.push({
          id,
          profileId: profile.id,
          authorId: me,
          text: text.trim(),
          createdAt: nowIso(),
          legacy: null,
        });
      },
    );
    setText("");
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t("notesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t("notesHint")}</p>
          <ImbcNotesList notes={notes} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("noteAdd")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            aria-label={t("noteText")}
            placeholder={t("noteText")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div>
            <Button disabled={!text.trim()} onClick={add}>
              {t("noteAdd")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
