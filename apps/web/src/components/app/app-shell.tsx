import { can } from "@imbc/contracts";
import {
  BuildingIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  SearchIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect } from "react";
import { Link, Outlet, useLocation, useMatches, useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { LocaleSwitcher } from "@/components/app/locale-switcher";
import { Logo } from "@/components/app/logo";
import { PageTitle } from "@/components/app/page-title";
import { SessionStatus } from "@/components/auth/session-status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ApiError } from "@/lib/api";
import { authDestination, useLogout, useMe } from "@/lib/session";

/** `handle` рабочего маршрута: ключ заголовка вкладки, пока страница ещё не показана. */
export interface AppRouteHandle {
  title?: string;
}

/**
 * Оболочка рабочих страниц. Пункты меню берутся из той же PolicyMatrix, что проверяет сервер:
 * интерфейс не показывает недоступное, но решает всегда сервер (GEN-08, GEN-10).
 */
export function AppShell() {
  const t = useTranslations();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const me = useMe();
  const logout = useLogout();

  useEffect(() => {
    const back = encodeURIComponent(pathname + search);
    if (me.error instanceof ApiError) {
      if (me.error.status === 401) void navigate(`/login?error=session_expired&returnTo=${back}`, { replace: true });
    } else if (me.data && !me.data.gates.mfa) {
      void navigate(`/auth/verify?returnTo=${back}`, { replace: true });
    } else if (me.data && !me.data.gates.responsibility) {
      void navigate(`/auth/responsibility?returnTo=${back}`, { replace: true });
    } else if (me.data && authDestination(me.data, pathname) !== pathname) {
      void navigate(authDestination(me.data, pathname), { replace: true });
    }
  }, [me.error, me.data, pathname, search, navigate]);

  // Пока страница не показана (проверка сеанса, переход по шлюзу), во вкладке уже её заголовок
  // из handle маршрута. Когда страница на экране, заголовок ставит она: оболочка свой не рендерит.
  const handle = useMatches().at(-1)?.handle as AppRouteHandle | undefined;
  const gateTitle = <PageTitle title={handle?.title ? t(handle.title) : undefined} />;

  if (me.isError && !(me.error instanceof ApiError && me.error.status === 401)) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        {gateTitle}
        <SessionStatus error retry={() => void me.refetch()} />
      </div>
    );
  }
  if (
    me.isError ||
    !me.data ||
    !me.data.gates.mfa ||
    !me.data.gates.responsibility ||
    authDestination(me.data, pathname) !== pathname
  ) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        {gateTitle}
        <SessionStatus />
      </div>
    );
  }

  const role = me.data.user.role;
  // Дашборд — первым: это стартовая страница оператора, наблюдателя и директора (OPR-31).
  // Очередь проверки — перед каталогом: у SME она первая, это его стартовая страница.
  // Аккаунты — перед «Моим аккаунтом»: у администратора это первый пункт и стартовая страница.
  // Адрес не `/accounts`: `/account` подсвечивался бы и на нём (startsWith).
  // `active` — начала адресов, на которых пункт подсвечен; по умолчанию — его href.
  const items: { href: string; label: string; icon: typeof SearchIcon; show: boolean; active?: string[] }[] = [
    { href: "/dashboard", label: t("nav.dashboard"), icon: LayoutDashboardIcon, show: !!can(role, "dashboard.read") },
    { href: "/reviews", label: t("nav.reviews"), icon: ClipboardListIcon, show: !!can(role, "review.take") },
    {
      href: "/catalog",
      label: t("nav.catalog"),
      icon: SearchIcon,
      show: !!can(role, "catalog.search"),
      // Страница компании открывается из каталога.
      active: ["/catalog", "/companies"],
    },
    { href: "/profile", label: t("nav.profile"), icon: BuildingIcon, show: !!can(role, "profile.edit") },
    {
      href: "/admin/accounts",
      label: t("nav.adminAccounts"),
      icon: UsersIcon,
      show: !!can(role, "accounts.manage"),
    },
    { href: "/account", label: t("nav.account"), icon: UserRoundIcon, show: true },
  ].filter((i) => i.show);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" mobileTitle={t("nav.sheetTitle")} mobileDescription={t("nav.sheetDescription")}>
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1.5 font-semibold">
            {/* Сайдбар тёмно-синий — логотипу подложка не нужна; квадратного знака нет,
                поэтому в свёрнутом виде логотип скрыт (NFR-15). Название — в sr-only рядом,
                поэтому логотип декоративный: диктор не читает имя дважды. */}
            <Logo decorative className="h-7 group-data-[collapsible=icon]:hidden" />
            <span className="sr-only">{t("common.appName")}</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {items.map((i) => (
                <SidebarMenuItem key={i.href}>
                  <SidebarMenuButton
                    render={<Link to={i.href} />}
                    isActive={(i.active ?? [i.href]).some((prefix) => pathname.startsWith(prefix))}
                    tooltip={i.label}
                  >
                    <i.icon />
                    <span>{i.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          {logout.isError && (
            <Alert variant="destructive">
              <AlertDescription>{t("auth.logoutError")}</AlertDescription>
            </Alert>
          )}
          <SidebarMenu>
            <SidebarMenuItem>
              {/* Видимый текст — адрес; имя кнопки называет действие и содержит этот адрес (WCAG 2.5.3). */}
              <SidebarMenuButton
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
                tooltip={t("common.signOut")}
                aria-label={t("nav.signOutAs", { email: me.data.user.email })}
              >
                <LogOutIcon />
                <span className="truncate">{me.data.user.email}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      {/* min-w-0: flex-элемент с min-width: auto растянула бы широкая таблица каталога, и страница стала бы
          шире окна; так таблица прокручивается в своём контейнере. */}
      <SidebarInset className="min-w-0">
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger aria-label={t("nav.toggleSidebar")} />
          {/* base-nova задаёт вертикальному разделителю data-vertical:self-stretch: с явной высотой
              stretch не растягивает, и линия встаёт к верху шапки, а не по центру. Высота и выравнивание —
              как в блоке sidebar-07 base-nova. */}
          <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
          <div className="flex-1" />
          <LocaleSwitcher />
        </header>
        <div className="flex-1 p-4 md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
