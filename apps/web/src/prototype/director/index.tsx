import {
  BookOpenIcon,
  FactoryIcon,
  FileTextIcon,
  HandshakeIcon,
  MessagesSquareIcon,
  ScrollTextIcon,
  TrendingUpIcon,
} from "lucide-react";
import { Navigate } from "react-router";

import { translate } from "../i18n";
import { type CabinetModule, protoPath } from "../registry";
import { AuditScreen } from "./audit-page";
import { DossierScreen } from "./dossier-page";
import { ForecastScreen } from "./forecast-page";
import { OperatorsScreen } from "./operators-page";
import { ProfilesScreen } from "./profiles-page";
import { ReferencesScreen } from "./references-page";
import { RequestsScreen } from "./requests-page";
import { TechFilesScreen } from "./tech-files-page";
import { texts } from "./texts";

/** Кабинет генерального директора IMBC: только чтение (GEN-04), журнал аудита (раздел 8.4). Задача 6 плана. */
export const cabinet: CabinetModule = {
  role: "director",
  menu: [
    { href: protoPath("director", "profiles"), label: (l) => translate(texts, l, "menuProfiles"), icon: FactoryIcon },
    { href: protoPath("director", "audit"), label: (l) => translate(texts, l, "menuAudit"), icon: ScrollTextIcon },
    {
      href: protoPath("director", "operators"),
      label: (l) => translate(texts, l, "menuOperators"),
      icon: HandshakeIcon,
    },
    {
      href: protoPath("director", "requests"),
      label: (l) => translate(texts, l, "menuRequests"),
      icon: MessagesSquareIcon,
    },
    {
      href: protoPath("director", "references"),
      label: (l) => translate(texts, l, "menuReferences"),
      icon: BookOpenIcon,
    },
    {
      href: protoPath("director", "forecast"),
      label: (l) => translate(texts, l, "menuForecast"),
      icon: TrendingUpIcon,
      badge: "release2",
    },
    {
      href: protoPath("director", "tech-files"),
      label: (l) => translate(texts, l, "menuTechFiles"),
      icon: FileTextIcon,
      badge: "release2",
    },
  ],
  routes: [
    { index: true, element: <Navigate to={protoPath("director", "profiles")} replace /> },
    { path: "profiles", element: <ProfilesScreen /> },
    { path: "profiles/:profileId", element: <DossierScreen /> },
    { path: "audit", element: <AuditScreen /> },
    { path: "operators", element: <OperatorsScreen /> },
    { path: "requests", element: <RequestsScreen /> },
    { path: "references", element: <ReferencesScreen /> },
    { path: "forecast", element: <ForecastScreen /> },
    { path: "tech-files", element: <TechFilesScreen /> },
  ],
};
