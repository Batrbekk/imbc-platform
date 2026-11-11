import { LOCALES, type Locale } from "@imbc/contracts";
import { LanguagesIcon } from "lucide-react";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isLocale } from "@/i18n/locale";
import { useLocaleSwitch } from "@/i18n/provider";

const LABELS: Record<Locale, string> = { kk: "Қазақша", ru: "Русский", en: "English" };

/** Язык хранится в cookie, адрес страницы не меняется — ссылки с фильтрами остаются общими. */
export function LocaleSwitcher({ variant = "ghost" }: { variant?: "ghost" | "outline" }) {
  const { locale, pending, change } = useLocaleSwitch();
  const t = useTranslations("common");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant={variant} size="sm" disabled={pending} aria-label={t("language")} />}
      >
        <LanguagesIcon />
        {locale.toUpperCase()}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Base UI передаёт значение как unknown: принимаем только известные языки. */}
        <DropdownMenuRadioGroup value={locale} onValueChange={(value) => isLocale(value) && void change(value)}>
          {LOCALES.map((l) => (
            // Как в Radix, выбор языка закрывает меню (в Base UI по умолчанию — нет).
            <DropdownMenuRadioItem key={l} value={l} closeOnClick>
              {LABELS[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
