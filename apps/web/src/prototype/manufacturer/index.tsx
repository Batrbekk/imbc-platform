import type { Locale } from "@imbc/contracts";
import {
  AwardIcon,
  BellIcon,
  FileSearchIcon,
  FileTextIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  TrendingUpIcon,
} from "lucide-react";
import { Navigate } from "react-router";

import { translate } from "../i18n";
import { type CabinetModule, protoPath } from "../registry";
import { ForecastPage } from "./forecast-page";
import { NotificationsPage } from "./notifications-page";
import { ProfilePage } from "./profile-page";
import { RequestsPage } from "./requests-page";
import { SectionPage } from "./section-page";
import { TechPage } from "./tech-page";
import { type TextKey, texts } from "./texts";
import { TierPage } from "./tier-page";
import { UpdateStatusPage } from "./update-status-page";

const item = (screen: string, key: TextKey) => ({
  href: protoPath("manufacturer", screen),
  label: (l: Locale) => translate(texts, l, key),
});

/** Кабинет производителя: разделы 5.2–5.5, 6.10, 7.4, 8.2 (задача 2 плана). */
export const cabinet: CabinetModule = {
  role: "manufacturer",
  menu: [
    { ...item("profile", "menuProfile"), icon: FileTextIcon },
    { ...item("update-status", "menuUpdateStatus"), icon: RefreshCwIcon },
    { ...item("requests", "menuRequests"), icon: MessageSquareIcon },
    { ...item("forecast", "menuForecast"), icon: TrendingUpIcon, badge: "release2" },
    { ...item("technical-requirements", "menuTech"), icon: FileSearchIcon, badge: "release2" },
    { ...item("tier", "menuTier"), icon: AwardIcon },
    { ...item("notifications", "menuNotifications"), icon: BellIcon },
  ],
  routes: [
    { index: true, element: <Navigate to="profile" replace /> },
    { path: "profile", element: <ProfilePage /> },
    { path: "profile/:section", element: <SectionPage /> },
    { path: "update-status", element: <UpdateStatusPage /> },
    { path: "requests", element: <RequestsPage /> },
    { path: "forecast", element: <ForecastPage /> },
    { path: "technical-requirements", element: <TechPage /> },
    { path: "tier", element: <TierPage /> },
    { path: "notifications", element: <NotificationsPage /> },
  ],
};
