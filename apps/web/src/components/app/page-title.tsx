import { useEffect } from "react";
import { useTranslations } from "use-intl";

/**
 * Заголовок вкладки по шаблону Next: «Страница · Платформа IMBC» или название платформы.
 * Текст ставится в единственный <title> из index.html (`document.title`), а не рендером <title>:
 * React 19 поднял бы второй элемент рядом со статичным. На странице одновременно один PageTitle.
 */
export function PageTitle({ title }: { title?: string }) {
  const t = useTranslations("common");
  const appName = t("appName");
  const text = title ? `${title} · ${appName}` : appName;
  useEffect(() => {
    document.title = text;
  }, [text]);
  return null;
}
