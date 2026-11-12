import { Building2Icon, DownloadIcon, KeyRoundIcon, MailIcon, MessagesSquareIcon } from "lucide-react";
import { Navigate } from "react-router";

import { translate } from "../i18n";
import { type CabinetModule, protoPath } from "../registry";
import { CompanyCardScreen } from "./company-card";
import { ExportScreen } from "./export";
import { ManufacturersScreen } from "./manufacturers";
import { PullApiScreen } from "./pull-api";
import { RequestsScreen } from "./requests";
import { SubscriptionsScreen } from "./subscriptions";
import { texts } from "./texts";

/** Кабинет оператора: разделы 7.2–7.6, GEN-12 (задача 5 плана). */
export const cabinet: CabinetModule = {
  role: "operator",
  menu: [
    {
      href: protoPath("operator", "manufacturers"),
      label: (l) => translate(texts, l, "menuManufacturers"),
      icon: Building2Icon,
    },
    {
      href: protoPath("operator", "requests"),
      label: (l) => translate(texts, l, "menuRequests"),
      icon: MessagesSquareIcon,
    },
    { href: protoPath("operator", "export"), label: (l) => translate(texts, l, "menuExport"), icon: DownloadIcon },
    {
      href: protoPath("operator", "subscriptions"),
      label: (l) => translate(texts, l, "menuSubscriptions"),
      icon: MailIcon,
      badge: "release2",
    },
    { href: protoPath("operator", "api"), label: (l) => translate(texts, l, "menuApi"), icon: KeyRoundIcon },
  ],
  routes: [
    { index: true, element: <Navigate to={protoPath("operator", "manufacturers")} replace /> },
    { path: "manufacturers", element: <ManufacturersScreen /> },
    { path: "manufacturers/:profileId", element: <CompanyCardScreen /> },
    { path: "requests", element: <RequestsScreen /> },
    { path: "export", element: <ExportScreen /> },
    { path: "subscriptions", element: <SubscriptionsScreen /> },
    { path: "api", element: <PullApiScreen /> },
  ],
};
