import { useLayoutEffect } from "react";
import { useTranslations } from "use-intl";

/**
 * Заголовок вкладки: «Страница · Платформа IMBC» или название платформы.
 * Текст ставится в единственный <title> из index.html (`document.title`), а не рендером <title>:
 * React 19 поднял бы второй элемент рядом со статичным. На странице одновременно один PageTitle.
 *
 * Layout effect ставит заголовок до отрисовки кадра, поэтому кадра со старым заголовком нет, а
 * объявление смены страницы (RouteAnnouncer в routes/root.tsx) читает уже новый. При снятии
 * заголовок возвращается к названию платформы: страница без своего PageTitle не унаследует чужой.
 */
export function PageTitle({ title }: { title?: string }) {
  const t = useTranslations("common");
  const appName = t("appName");
  const text = title ? `${title} · ${appName}` : appName;
  useLayoutEffect(() => {
    document.title = text;
    return () => {
      document.title = appName;
    };
  }, [text, appName]);
  return null;
}
