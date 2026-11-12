import { BadgeCheckIcon, ClipboardCheckIcon, InboxIcon, MessagesSquareIcon } from "lucide-react";
import { Navigate } from "react-router";

import { translate } from "../i18n";
import { type CabinetModule, protoPath } from "../registry";
import { DossierScreen } from "./dossier-page";
import { ManufacturerRequestsScreen } from "./manufacturer-requests-page";
import { MarksScreen } from "./marks-page";
import { ProfilesScreen } from "./profiles-page";
import { RequestsScreen } from "./requests-page";
import { texts } from "./texts";

/** Кабинет SME: разделы 6.1–6.8, 6.10 (задача 3 плана). */
export const cabinet: CabinetModule = {
  role: "expert",
  menu: [
    {
      href: protoPath("expert", "profiles"),
      label: (l) => translate(texts, l, "menuProfiles"),
      icon: ClipboardCheckIcon,
    },
    { href: protoPath("expert", "marks"), label: (l) => translate(texts, l, "menuMarks"), icon: BadgeCheckIcon },
    {
      href: protoPath("expert", "requests"),
      label: (l) => translate(texts, l, "menuRequests"),
      icon: MessagesSquareIcon,
    },
    {
      href: protoPath("expert", "manufacturer-requests"),
      label: (l) => translate(texts, l, "menuManufacturerRequests"),
      icon: InboxIcon,
    },
  ],
  routes: [
    { index: true, element: <Navigate to={protoPath("expert", "profiles")} replace /> },
    { path: "profiles", element: <ProfilesScreen /> },
    { path: "profiles/:profileId", element: <DossierScreen /> },
    { path: "marks", element: <MarksScreen /> },
    { path: "requests", element: <RequestsScreen /> },
    { path: "manufacturer-requests", element: <ManufacturerRequestsScreen /> },
  ],
};
