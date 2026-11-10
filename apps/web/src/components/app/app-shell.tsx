"use client";

import { can } from "@imbc/contracts";
import { BuildingIcon, LayoutDashboardIcon, LogOutIcon, SearchIcon, UserRoundIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect } from "react";
import { BrandMark } from "@/components/app/brand";
import { SessionStatus } from "@/components/auth/session-status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LocaleSwitcher } from "@/components/app/locale-switcher";
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

/**
 * Оболочка рабочих страниц. Пункты меню берутся из той же PolicyMatrix, что проверяет сервер:
 * интерфейс не показывает недоступное, но решает всегда сервер (GEN-10).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const logout = useLogout();

  useEffect(() => {
    const back = encodeURIComponent(pathname + window.location.search);
    if (me.error instanceof ApiError) {
      if (me.error.status === 401) router.replace(`/login?error=session_expired&returnTo=${back}`);
    } else if (me.data && !me.data.gates.mfa) {
      router.replace(`/auth/verify?returnTo=${back}`);
    } else if (me.data && !me.data.gates.responsibility) {
      router.replace(`/auth/responsibility?returnTo=${back}`);
    } else if (me.data && authDestination(me.data, pathname) !== pathname) {
      router.replace(authDestination(me.data, pathname));
    }
  }, [me.error, me.data, pathname, router]);

  if (me.isError && !(me.error instanceof ApiError && me.error.status === 401)) {
    return (
      <div className="flex min-h-svh items-center justify-center">
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
        <SessionStatus />
      </div>
    );
  }

  const role = me.data.user.role;
  const items = [
    { href: "/catalog", label: t("nav.catalog"), icon: SearchIcon, show: !!can(role, "catalog.search") },
    { href: "/dashboard", label: t("nav.dashboard"), icon: LayoutDashboardIcon, show: !!can(role, "dashboard.read") },
    { href: "/profile", label: t("nav.profile"), icon: BuildingIcon, show: role === "manufacturer" },
    { href: "/account", label: t("nav.account"), icon: UserRoundIcon, show: true },
  ].filter((i) => i.show);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1.5 font-semibold">
            <BrandMark className="size-7 shrink-0" />
            <span className="truncate group-data-[collapsible=icon]:hidden">{t("common.appName")}</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {items.map((i) => (
                <SidebarMenuItem key={i.href}>
                  <SidebarMenuButton asChild isActive={pathname.startsWith(i.href)} tooltip={i.label}>
                    <Link href={i.href}>
                      <i.icon />
                      <span>{i.label}</span>
                    </Link>
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
              <SidebarMenuButton
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
                tooltip={t("common.signOut")}
              >
                <LogOutIcon />
                <span className="truncate">{me.data.user.email}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="flex-1" />
          <LocaleSwitcher />
        </header>
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
