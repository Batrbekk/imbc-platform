import type { Role } from "@imbc/contracts";
import { Suspense, use, useEffect } from "react";
import { Link, useLocation } from "react-router";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import { clearReloadFlag } from "@/lib/reload-guard";

import { PROTOTYPE_RELOAD, ProtoBoundary } from "./boundary";
import { useProtoLocale } from "./i18n";
import { useCommonTexts } from "./labels";
import { loadCabinet } from "./registry";

/**
 * Группа «Прототип» под готовыми пунктами меню: пункты модуля роли сеанса. Модуль без пунктов
 * (наблюдатель) группы не показывает. Подпись бросила или модуль не загрузился — группы нет,
 * готовые пункты меню и страница роли не задеты; устаревший чанк — одна перезагрузка страницы.
 */
export function PrototypeMenu({ role }: { role: Role }) {
  return (
    <ProtoBoundary key={role} chunkError="reload" fallback={() => null}>
      <Suspense fallback={null}>
        <MenuGroup role={role} />
      </Suspense>
    </ProtoBoundary>
  );
}

function MenuGroup({ role }: { role: Role }) {
  const cabinet = use(loadCabinet(role));
  // Модуль загрузился: следующий устаревший чанк снова может перезагрузить страницу один раз.
  useEffect(() => clearReloadFlag(PROTOTYPE_RELOAD), []);
  const { pathname } = useLocation();
  const locale = useProtoLocale();
  const t = useCommonTexts();
  if (cabinet.menu.length === 0) return null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("menuGroup")}</SidebarGroupLabel>
      <SidebarMenu>
        {cabinet.menu.map((item) => {
          const label = item.label(locale);
          return (
            <SidebarMenuItem key={item.href}>
              {/* Бейдж ui/sidebar стоит абсолютно справа и места себе не оставляет: кнопка с бейджем
                  держит правый отступ шире «Release 2» (свёрнутый сайдбар бейдж прячет и отступ
                  перекрывает своим p-2!), а подпись — последний span — обрезается многоточием
                  (`[&>span:last-child]:truncate` кнопки) и хранит полный текст в title. */}
              <SidebarMenuButton
                render={<Link to={item.href} />}
                isActive={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                tooltip={label}
                className={item.badge ? "pr-20" : undefined}
              >
                <item.icon />
                <span title={label}>{label}</span>
              </SidebarMenuButton>
              {item.badge === "release2" && <SidebarMenuBadge>{t("release2")}</SidebarMenuBadge>}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
