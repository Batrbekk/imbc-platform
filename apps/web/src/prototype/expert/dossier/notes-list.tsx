// Внутренние заметки IMBC (IMBC-15) и поля, перенесённые из Excel (MIG-09, IMBC-06: рейтинг — только заметка).
import { useFormat } from "@/i18n/format";
import type { ImbcNote } from "@/prototype/data";
import { useDictionary } from "@/prototype/i18n";
import { accountName } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import { dossierTexts } from "./texts";

export function ImbcNotesList({ notes }: { notes: ImbcNote[] }) {
  const t = useDictionary(dossierTexts);
  const format = useFormat();
  const state = useProto();
  if (notes.length === 0) return <p className="text-sm text-muted-foreground">{t("notesEmpty")}</p>;
  const sorted = [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((n) => (
        <li key={n.id} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <span className="text-xs text-muted-foreground">
            {accountName(state, n.authorId)} · {format.dateTime(n.createdAt)}
          </span>
          <p className="whitespace-pre-wrap">{n.text}</p>
          {n.legacy && (
            <dl className="grid gap-1 rounded-md bg-muted/50 p-2 text-xs">
              <dt className="font-medium">{t("legacyFields")}</dt>
              {Object.entries(n.legacy).map(([key, value]) => (
                <dd key={key}>
                  {key}: {value}
                </dd>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}
