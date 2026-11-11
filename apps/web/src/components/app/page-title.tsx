import { useTranslations } from "use-intl";

/**
 * Заголовок вкладки по шаблону Next: «Страница · Платформа IMBC» или название платформы.
 * React 19 поднимает <title> в <head>; одновременно на странице должен быть один PageTitle.
 */
export function PageTitle({ title }: { title?: string }) {
  const t = useTranslations("common");
  const appName = t("appName");
  return <title>{title ? `${title} · ${appName}` : appName}</title>;
}
