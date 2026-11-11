import { cn } from "cn";
import { useTranslations } from "use-intl";

import logoUrl from "@/assets/imbc-logo.png";

/**
 * Логотип IMBC — файл заказчика без перерисовки и обрезки (NFR-15). Он серебристый
 * на прозрачном фоне и на белом почти не читается, поэтому на светлых поверхностях
 * его кладут на тёмно-синюю подложку (`plate`). Высоту задаёт `className`.
 * `decorative` — когда рядом уже есть название (текст или `aria-label` ссылки):
 * пустой `alt`, чтобы экранный диктор не читал имя дважды.
 */
export function Logo({
  className,
  plate = false,
  decorative = false,
}: {
  className?: string;
  plate?: boolean;
  decorative?: boolean;
}) {
  const t = useTranslations("common");
  const image = (
    <img
      src={logoUrl}
      alt={decorative ? "" : t("logoAlt")}
      width={736}
      height={212}
      className={cn("w-auto", className)}
    />
  );
  if (!plate) return image;
  return <span className="inline-flex shrink-0 rounded-md bg-sidebar px-2.5 py-1.5">{image}</span>;
}
