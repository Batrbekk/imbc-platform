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
 * Маркер временного текста: с него начинаются заглушки условий и политики в файлах переводов и текст NDA
 * из seed стенда. Отметку «Заглушка» решает сам текст: настоящий текст IMBC придёт без маркера (FC-02).
 */
export const PLACEHOLDER = /^(PLACEHOLDER|ВРЕМЕННЫЙ ТЕКСТ|УАҚЫТША МӘТІН) — /;

/**
 * Текст соглашения перед галочкой формы регистрации (MAN-01): условия платформы, политика персональных
 * данных, NDA. Текст — обычный, абзацы разделены пустой строкой; HTML не разбирается. Временный текст
 * помечен «Заглушка», чтобы его не приняли за юридический. Закрытие возвращает фокус на кнопку-триггер.
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
          {PLACEHOLDER.test(body.trimStart()) && <Badge variant="secondary">{t("placeholder")}</Badge>}
          <DialogTitle id={titleId} className="leading-snug">
            {title}
          </DialogTitle>
        </DialogHeader>
        {/* Длинный текст прокручивается и с клавиатуры: область в порядке Tab, названа заголовком. */}
        <div
          role="document"
          aria-labelledby={titleId}
          tabIndex={0}
          className="min-h-0 overflow-y-auto rounded-md break-words whitespace-pre-line leading-relaxed outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
