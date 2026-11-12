// Каркас экрана кабинета производителя: ProtoPage и переключатель ведущего «показать как».
// Переключатель — не возможность платформы: он только выбирает профиль демо-данных (GEN-11 в продукте).
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { ProtoPage } from "../components";
import { useDictionary } from "../i18n";
import { useCommonTexts } from "../labels";
import { useActor, useProto } from "../store";
import { useViewedProfile, VIEW_AS_OPTIONS } from "./view-as";
import { texts } from "./texts";

export function ManufacturerPage({
  title,
  description,
  release2 = false,
  children,
}: {
  title: string;
  description?: ReactNode;
  release2?: boolean;
  children: ReactNode;
}) {
  return (
    <ProtoPage title={title} description={description} release2={release2}>
      <ViewAsBar />
      {children}
    </ProtoPage>
  );
}

function ViewAsBar() {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const actor = useActor();
  const { profile, select } = useViewedProfile();
  const profiles = useProto((s) => s.profiles);
  const ids = new Set<string>(VIEW_AS_OPTIONS);
  const own = profiles.find((p) => p.organizationId === actor.organizationId);
  if (own) ids.add(own.id);
  const items = profiles
    .filter((p) => ids.has(p.id))
    .map((p) => {
      const parts = [common(`profileStatus.${p.status}`)];
      if (p.pendingChanges) parts.push(common("pendingChanges"));
      if (p.updateStatus && p.updateStatus !== "active") parts.push(common(`updateStatus.${p.updateStatus}`));
      if (p.origin === "migrated") parts.push(t("migrated"));
      const name = p.id === own?.id ? t("ownCompany", { name: p.nameRu }) : p.nameRu;
      return { value: p.id, label: `${parts.join(" · ")} — ${name}` };
    });
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-muted/40 p-3 sm:flex-row sm:items-center">
      <Label id="manufacturer-view-as" className="shrink-0">
        {t("viewAs")}
      </Label>
      <Select items={items} value={profile.id} onValueChange={(v) => typeof v === "string" && select(v)}>
        <SelectTrigger className="w-full min-w-0 sm:w-auto sm:max-w-md" aria-labelledby="manufacturer-view-as">
          <SelectValue className="truncate" />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{t("viewAsHint")}</p>
    </div>
  );
}

/** Начальный адрес кабинета ведёт на профиль и сохраняет выбор ведущего в адресе (`?as=`). */
export function IndexRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "profile", search }} replace />;
}
