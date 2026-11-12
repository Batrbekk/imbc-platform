// Общие части экранов профиля: статус секции (MAN-46) и список того, что мешает отправке (MAN-41).
import type { ProfileSection } from "@imbc/contracts";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";

import { useDictionary } from "../i18n";
import { useCommonTexts } from "../labels";
import { type Missing, type SectionCompleteness, sectionHref, type SectionState, SECTIONS } from "./model";
import { type TextKey, texts, useDocumentLabel } from "./texts";
import { useWithViewAs } from "./view-as";

const STATE_VARIANT: Record<SectionState, "default" | "secondary" | "outline" | "destructive"> = {
  not_sent: "outline",
  submitted: "secondary",
  under_review: "secondary",
  verified: "default",
  rejected: "destructive",
  corrected: "outline",
  pending: "outline",
  pending_sent: "secondary",
};

export function SectionStateBadge({ state }: { state: SectionState }) {
  const t = useDictionary(texts);
  return <Badge variant={STATE_VARIANT[state]}>{t(`state.${state}`)}</Badge>;
}

/** Подпись недостающего пункта. */
function useMissingText() {
  const t = useDictionary(texts);
  const documentLabel = useDocumentLabel();
  return (m: Missing) => {
    if (m.key === "field") return t(`field.${m.values!.field}` as TextKey);
    if (m.key === "document") return documentLabel(m.values!.type!);
    return t(`missing.${m.key}`, m.values);
  };
}

/** Что не заполнено, по секциям, со ссылкой на секцию. */
export function MissingList({ bySection }: { bySection: Partial<Record<ProfileSection, SectionCompleteness>> }) {
  const common = useCommonTexts();
  const text = useMissingText();
  const withViewAs = useWithViewAs();
  const sections = SECTIONS.filter((s) => (bySection[s]?.missing.length ?? 0) > 0);
  return (
    <ul className="flex flex-col gap-3">
      {sections.map((s) => (
        <li key={s} className="text-sm">
          <Link className="font-medium underline underline-offset-4" to={withViewAs(sectionHref(s))}>
            {common(`section.${s}`)}
          </Link>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {bySection[s]!.missing.map((m, i) => (
              <li key={i}>{text(m)}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
