"use client";

import { can } from "@imbc/contracts";
import { BuildingIcon, LayoutDashboardIcon, LogOutIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect } from "react";
import { BrandMark } from "@/components/app/brand";
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
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { useMe } from "@/lib/session";

/**
 * Оболочка рабочих страниц. Пункты меню берутся из той же PolicyMatrix, что проверяет сервер:
 * интерфейс не показывает недоступное, но решает всегда сервер (GEN-10).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();

  useEffect(() => {
    const back = encodeURIComponent(pathname + window.location.search);
    if (me.error instanceof ApiError) {
      if (me.error.code === "unauthenticated") router.replace(`/login?returnTo=${back}`);
    } else if (me.data && !me.data.gates.mfa) {
      router.replace(`/auth/verify?returnTo=${back}`);
    } else if (me.data && !me.data.gates.responsibility) {
      router.replace(`/auth/responsibility?returnTo=${back}`);
    }
  }, [me.error, me.data, pathname, router]);

  if (!me.data || !me.data.gates.mfa || !me.data.gates.responsibility) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  const role = me.data.user.role;
  const items = [
    { href: "/catalog", label: t("nav.catalog"), icon: SearchIcon, show: !!can(role, "catalog.search") },
    { href: "/dashboard", label: t("nav.dashboard"), icon: LayoutDashboardIcon, show: !!can(role, "dashboard.read") },
    { href: "/profile", label: t("nav.profile"), icon: BuildingIcon, show: role === "manufacturer" },
  ].filter((i) => i.show);

  const logout = async () => {
    const r = await api<{ redirectTo: string }>("/auth/logout", { method: "POST" });
    window.location.assign(r.redirectTo);
  };

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
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={logout} tooltip={t("common.signOut")}>
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
