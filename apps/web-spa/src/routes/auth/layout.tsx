import { ShieldCheckIcon } from "lucide-react";
import { Link, Outlet } from "react-router";
import { useTranslations } from "use-intl";

import { LocaleSwitcher } from "@/components/app/locale-switcher";
import { Logo } from "@/components/app/logo";

/** Общая рамка экранов входа: все они принадлежат IMBC, интерфейс IdP не показывается. */
export function AuthLayout() {
  const t = useTranslations("common");
  const auth = useTranslations("authLayout");
  return (
    <div className="flex min-h-svh flex-col bg-linear-to-br from-blue-50/70 via-background to-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
        {/* Имя ссылки — название платформы на языке интерфейса при любой ширине; логотип рядом декоративный. */}
        <Link to="/login" aria-label={t("appName")} className="flex items-center gap-2 font-semibold tracking-tight">
          <Logo plate decorative className="h-6" />
          <span className="hidden sm:inline">{t("appName")}</span>
        </Link>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-4 py-8 sm:px-8 lg:grid-cols-2 lg:gap-20">
        <section className="hidden space-y-8 lg:block">
          {/* Логотип IMBC вместо плитки со значком (NFR-15); одна подложка. Название — в тексте ниже. */}
          <div className="inline-flex rounded-2xl bg-sidebar p-4 shadow-lg shadow-primary/15">
            <Logo decorative className="h-12" />
          </div>
          <div className="space-y-4">
            <p className="text-sm font-semibold tracking-wide text-primary">IMBC</p>
            <h2 className="max-w-lg text-4xl font-semibold leading-tight tracking-tight">{auth("title")}</h2>
            <p className="max-w-md text-base leading-relaxed text-muted-foreground">{auth("description")}</p>
          </div>
          <div className="flex max-w-md items-start gap-3 border-t pt-6 text-sm leading-relaxed text-muted-foreground">
            <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-primary" />
            <p>{auth("security")}</p>
          </div>
        </section>
        <div className="mx-auto w-full max-w-md">
          <Outlet />
        </div>
      </main>
      <footer className="px-4 py-5 text-center text-xs text-muted-foreground">{auth("footer")}</footer>
    </div>
  );
}
