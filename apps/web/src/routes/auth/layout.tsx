import { ShieldCheckIcon } from "lucide-react";
import { Link, Outlet } from "react-router";
import { useTranslations } from "use-intl";

import { LocaleSwitcher } from "@/components/app/locale-switcher";
import { Logo } from "@/components/app/logo";

/**
 * Общая рамка экранов входа: все они принадлежат IMBC, интерфейс IdP не показывается.
 * Две колонки по блоку shadcn `login-02` (NFR-15): слева логотип, язык и экран, справа — панель реестра.
 */
export function AuthLayout() {
  const t = useTranslations("common");
  const auth = useTranslations("authLayout");
  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4 p-6 md:p-10">
        <header className="flex items-center justify-between gap-4">
          {/* Логотип один и декоративный: имя ссылки — название платформы на языке интерфейса (LANG-01). */}
          <Link
            to="/login"
            aria-label={t("appName")}
            className="inline-flex rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Logo plate decorative className="h-6" />
          </Link>
          <LocaleSwitcher />
        </header>
        <main className="flex flex-1 items-center justify-center py-4">
          <Outlet />
        </main>
      </div>
      {/* Ниже lg панель скрыта display: none — и для программ чтения тоже. Длинная форма прокручивается, панель стоит. */}
      <aside className="hidden bg-sidebar p-10 text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-svh lg:flex-col">
        <div className="flex max-w-lg flex-1 flex-col justify-center gap-6">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">{auth("title")}</h2>
          <p className="max-w-md text-base leading-relaxed text-sidebar-foreground/80">{auth("description")}</p>
          <div className="flex max-w-md items-start gap-3 border-t border-sidebar-border pt-6 text-sm leading-relaxed text-sidebar-foreground/80">
            <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-sidebar-primary" aria-hidden="true" />
            <p>{auth("security")}</p>
          </div>
        </div>
        <p className="text-xs text-sidebar-foreground/70">{auth("footer")}</p>
      </aside>
    </div>
  );
}
