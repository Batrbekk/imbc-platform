import {
  ClipboardListIcon,
  FileStackIcon,
  FileTextIcon,
  KeyRoundIcon,
  ScrollTextIcon,
  TrendingUpIcon,
  UserPlusIcon,
} from "lucide-react";
import { Navigate } from "react-router";

import { translate } from "../i18n";
import { type CabinetMenuItem, type CabinetModule, protoPath } from "../registry";
import { ApiAccessScreen } from "./api-access";
import { AssignmentsScreen } from "./assignments";
import { AuditScreen } from "./audit";
import { ForecastScreen } from "./forecast";
import { MigrationScreen } from "./migration";
import { NdaScreen } from "./nda";
import { OrganizationsScreen } from "./organizations";
import { ReferencesScreen } from "./references";
import { TechFilesScreen } from "./tech-files";
import { texts } from "./texts";

const item = (
  screen: string,
  key: keyof (typeof texts)["en"],
  icon: CabinetMenuItem["icon"],
  badge?: "release2",
): CabinetMenuItem => ({
  href: protoPath("administrator", screen),
  label: (l) => translate(texts, l, key),
  icon,
  ...(badge ? { badge } : {}),
});

/** Кабинет администратора IMBC: раздел 6.9, GEN-03, 7.6, 8.4 (задача 4 плана). */
export const cabinet: CabinetModule = {
  role: "administrator",
  // Пунктов «Организации и аккаунты» и «Справочники» нет: настоящие страницы — /admin/accounts (ADM-02) и
  // /references (ADM-08), пункты основного меню; одноимённые макеты путали. Маршруты и экраны макетов остаются
  // по прямому адресу как образец.
  menu: [
    item("assignments", "menu.assignments", ClipboardListIcon),
    item("nda", "menu.nda", FileTextIcon),
    item("forecast", "menu.forecast", TrendingUpIcon, "release2"),
    item("tech-files", "menu.techFiles", FileStackIcon, "release2"),
    item("migration", "menu.migration", UserPlusIcon),
    item("api", "menu.api", KeyRoundIcon),
    item("audit", "menu.audit", ScrollTextIcon),
  ],
  routes: [
    { index: true, element: <Navigate to="assignments" replace /> },
    { path: "organizations", element: <OrganizationsScreen /> },
    { path: "assignments", element: <AssignmentsScreen /> },
    { path: "references", element: <ReferencesScreen /> },
    { path: "nda", element: <NdaScreen /> },
    { path: "forecast", element: <ForecastScreen /> },
    { path: "tech-files", element: <TechFilesScreen /> },
    { path: "migration", element: <MigrationScreen /> },
    { path: "api", element: <ApiAccessScreen /> },
    { path: "audit", element: <AuditScreen /> },
  ],
};
