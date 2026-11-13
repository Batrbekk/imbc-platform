import { LEGAL_PLACEHOLDER_MARKER } from "@imbc/contracts";
import { type ReactElement, useId } from "react";
import { useTranslations } from "use-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Текст соглашения перед галочкой формы регистрации (MAN-01): условия платформы, политика персональных
 * данных, NDA. Текст — обычный, абзацы разделены пустой строкой; HTML не разбирается. Временный текст
 * (начинается с LEGAL_PLACEHOLDER_MARKER) помечен «Заглушка», чтобы его не приняли за юридический.
 * Закрытие возвращает фокус на кнопку-триггер.
 */
export function LegalDialog({ title, body, trigger }: { title: string; body: string; trigger: ReactElement }) {
  const t = useTranslations("legal");
  const titleId = useId();
  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      {/* Своя кнопка закрытия: у встроенной подпись «Close» не переводится (LANG-01). */}
      <DialogContent showCloseButton={false} className="flex max-h-[85dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          {LEGAL_PLACEHOLDER_MARKER.test(body.trimStart()) && <Badge variant="secondary">{t("placeholder")}</Badge>}
          <DialogTitle id={titleId} className="leading-snug">
            {title}
          </DialogTitle>
        </DialogHeader>
        {/* Длинный текст прокручивается и с клавиатуры: область в порядке Tab, названа заголовком.
            Внутренний отступ p-2 при отрицательном внешнем -m-2: текст стоит на месте, а кольцо фокуса
            обходит его с зазором 8px и не обрезается полем диалога. */}
        <div
          role="document"
          aria-labelledby={titleId}
          tabIndex={0}
          className="-m-2 min-h-0 overflow-y-auto rounded-md p-2 break-words whitespace-pre-line leading-relaxed outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {body}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t("close")}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
