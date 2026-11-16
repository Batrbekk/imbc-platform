import { entryDisplayName, type DictionaryChoicesPage, type MainInformationRead } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "use-intl";
import { api } from "@/lib/api";

export const fieldId = (path: string) => `profile-${path.replaceAll(".", "-")}`;
export function useFieldMessage(code: string | undefined) {
  const t = useTranslations("profileEditor");
  const known = [
    "required",
    "duplicate_email",
    "duplicate_phone",
    "multiple_focal_points",
    "phone_format",
    "email_format",
    "website_format",
    "reference_invalid",
    "reference_retired",
    "site_in_use",
    "site_invalid",
    "duplicate_site",
    "text_format",
  ];
  return code ? t(`errors.${known.includes(code) ? code : "validation"}`) : null;
}
export function useProfileChoices(
  kind: "region" | "contact_role",
  selected: MainInformationRead["selectedRegions"] = [],
) {
  const locale = useLocale() as "kk" | "ru" | "en";
  const query = useQuery({
    queryKey: ["profile", "choices", kind, locale],
    queryFn: async () => {
      const first = await api<DictionaryChoicesPage>(`/v1/dictionaries/${kind}/choices?lang=${locale}&pageSize=100`);
      const items = new Map(first.items.map((item) => [item.id, item]));
      for (let page = 2; items.size < first.total; page++) {
        const next = await api<DictionaryChoicesPage>(`/v1/dictionaries/${kind}/choices?lang=${locale}&pageSize=100&page=${page}`);
        const before = items.size;
        for (const item of next.items) items.set(item.id, item);
        if (items.size === before) break;
      }
      return { ...first, items: [...items.values()] };
    },
  });
  const choices = (query.data?.items ?? []).map((item) => ({ value: item.id, label: item.name, disabled: false }));
  for (const item of selected)
    if (!choices.some((choice) => choice.value === item.id))
      choices.push({ value: item.id, label: entryDisplayName(item.names, locale, item.code), disabled: true });
  return { ...query, choices };
}

export function moveRow<T>(rows: readonly T[], from: number, to: number): T[] {
  const copy = [...rows];
  const [item] = copy.splice(from, 1);
  if (item !== undefined) copy.splice(to, 0, item);
  return copy;
}
