import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/i18n/format";

import { useCommonTexts } from "../labels";

/** Сообщение переписки, уже готовое к показу: экран сам решает, называть ли автора (GEN-11, OPR-28). */
export interface ThreadEntry {
  id: string;
  author: string;
  /** Организация или роль под именем; производителю оператора не называют. */
  meta?: string;
  at: string;
  text: string;
}

/**
 * Переписка запроса (IMBC request, operator request): сообщения по времени и, с `onReply`, поле
 * ответа. Пустой ответ не отправляется. Operator request допускает один ответ (OPR-29) — после него
 * экран просто не передаёт `onReply`.
 */
export function RequestThread({
  entries,
  onReply,
  replyLabel,
  placeholder,
  emptyText,
}: {
  entries: ThreadEntry[];
  onReply?: (text: string) => void;
  replyLabel?: string;
  placeholder?: string;
  emptyText?: string;
}) {
  const t = useCommonTexts();
  const format = useFormat();
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || !onReply) return;
    onReply(value);
    setText("");
  };
  return (
    <div className="flex flex-col gap-3">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText ?? t("noMessages")}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">
                  {entry.author}
                  {entry.meta && <span className="font-normal text-muted-foreground"> · {entry.meta}</span>}
                </span>
                <span className="text-xs text-muted-foreground">{format.dateTime(entry.at)}</span>
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{entry.text}</p>
            </li>
          ))}
        </ol>
      )}
      {onReply && (
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <Textarea
            aria-label={placeholder ?? t("replyPlaceholder")}
            placeholder={placeholder ?? t("replyPlaceholder")}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div>
            <Button type="submit" disabled={!text.trim()}>
              {replyLabel ?? t("reply")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
