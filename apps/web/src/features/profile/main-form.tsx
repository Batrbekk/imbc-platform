import { fieldId, moveRow, useProfileChoices } from "./form-data";
import type { MainInformationRead, MainInformationWrite } from "@imbc/contracts";
import { PlusIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormat } from "@/i18n/format";
import { ProfileChoiceField, ProfileGroupError, ProfileRowActions, ProfileTextField } from "./form-fields";
import type { SectionFieldErrors } from "./section-draft";

export function MainInformationForm({
  value,
  source,
  onChange,
  disabled,
  errors,
}: {
  value: MainInformationWrite;
  source: MainInformationRead;
  onChange: (value: MainInformationWrite) => void;
  disabled: boolean;
  errors: SectionFieldErrors;
}) {
  const t = useTranslations("profileEditor");
  const format = useFormat();
  const regions = useProfileChoices("region", source.selectedRegions);
  const set = (field: "website" | "companyPhone" | "contactEmail", text: string) =>
    onChange({ ...value, [field]: text });
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <ProfileTextField
          path="companyPhone"
          label={t("companyPhone")}
          value={value.companyPhone}
          onChange={(next) => set("companyPhone", next)}
          disabled={disabled}
          errors={errors}
          type="tel"
          hint={t("phoneHint")}
        />
        <ProfileTextField
          path="contactEmail"
          label={t("contactEmail")}
          value={value.contactEmail}
          onChange={(next) => set("contactEmail", next)}
          disabled={disabled}
          errors={errors}
          type="email"
          hint={t("contactEmailHint")}
        />
        <ProfileTextField
          path="website"
          label={t("website")}
          value={value.website}
          onChange={(next) => set("website", next)}
          disabled={disabled}
          errors={errors}
          type="url"
          hint="https://example.com"
        />
      </div>
      <section id={fieldId("sites")} aria-labelledby="profile-sites-heading" aria-describedby={errors.sites ? `${fieldId("sites")}-error` : undefined} className="flex flex-col gap-3">
        <div>
          <h2 id="profile-sites-heading" className="text-lg font-semibold">
            {t("sitesTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("sitesHint")}</p>
        </div>
        <ProfileGroupError path="sites" errors={errors} />
        {regions.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t("referenceLoadError")}</AlertDescription>
            <Button type="button" variant="outline" size="sm" onClick={() => void regions.refetch()}>
              {t("retry")}
            </Button>
          </Alert>
        )}
        {value.sites.map((site, index) => (
          <Card key={site.identityId ?? index}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">{t("siteNumber", { number: format.number(index + 1) })}</CardTitle>
              {!disabled && (
                <ProfileRowActions
                  index={index}
                  count={value.sites.length}
                  disabled={disabled}
                  onMove={(to) => onChange({ ...value, sites: moveRow(value.sites, index, to) })}
                  onRemove={() => onChange({ ...value, sites: value.sites.filter((_, at) => at !== index) })}
                />
              )}
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <ProfileGroupError path={`sites.${index}.identityId`} errors={errors} />
              <ProfileTextField
                path={`sites.${index}.address`}
                label={t("productionAddress")}
                value={site.address}
                onChange={(address) =>
                  onChange({
                    ...value,
                    sites: value.sites.map((row, at) => (at === index ? { ...row, address } : row)),
                  })
                }
                disabled={disabled}
                errors={errors}
              />
              <ProfileTextField
                path={`sites.${index}.city`}
                label={t("city")}
                value={site.city}
                onChange={(city) =>
                  onChange({ ...value, sites: value.sites.map((row, at) => (at === index ? { ...row, city } : row)) })
                }
                disabled={disabled}
                errors={errors}
              />
              <ProfileChoiceField
                path={`sites.${index}.regionId`}
                label={t("region")}
                value={site.regionId}
                onChange={(regionId) =>
                  onChange({
                    ...value,
                    sites: value.sites.map((row, at) => (at === index ? { ...row, regionId } : row)),
                  })
                }
                disabled={disabled || regions.isPending || regions.isError}
                errors={errors}
                choices={regions.choices}
              />
            </CardContent>
          </Card>
        ))}
        {!value.sites.length && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("noSites")}</p>
        )}
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() =>
              onChange({
                ...value,
                sites: [...value.sites, { identityId: null, address: null, city: null, regionId: null }],
              })
            }
          >
            <PlusIcon />
            {t("addSite")}
          </Button>
        )}
      </section>
    </div>
  );
}

export function LegalInformationCard({ data }: { data: MainInformationRead }) {
  const t = useTranslations("profileEditor");
  const format = useFormat();
  const legal = data.legalInformation;
  const fields: [string, string | null][] = [
    [t("bin"), data.bin],
    [t("loginEmail"), data.loginEmail],
    [t("legalName"), legal.legalName],
    [t("alternativeName"), legal.alternativeName],
    [t("legalForm"), legal.legalForm],
    [t("director"), legal.directorFullName],
    [t("registeredOn"), format.date(legal.stateRegisteredOn)],
    [t("legalAddress"), legal.legalAddress],
  ];
  return (
    <Card role="region" aria-label={t("legalTitle")}>
      <CardHeader>
        <CardTitle>{t("legalTitle")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("legalReadOnly")}</p>
        <p className="text-xs text-muted-foreground">
          {data.source.provenance === "migration"
            ? t("sourceMigration")
            : data.source.state === "received"
              ? t("sourceReceived", { date: format.dateTime(data.source.readAt) })
              : data.source.state === "waiting"
                ? t("sourceWaiting")
                : t("sourceUnavailable")}
        </p>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm">
          {fields.map(([label, value]) => (
            <div key={label} className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words [overflow-wrap:anywhere]">{value || "—"}</dd>
            </div>
          ))}
          <div className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <dt className="text-muted-foreground">{t("founders")}</dt>
            <dd>
              <ul className="space-y-1">
                {legal.founders.length
                  ? legal.founders.map((name, index) => (
                      <li key={index} className="break-words [overflow-wrap:anywhere]">
                        {name}
                      </li>
                    ))
                  : "—"}
              </ul>
            </dd>
          </div>
          <div className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <dt className="text-muted-foreground">{t("oked")}</dt>
            <dd>
              <ul className="space-y-1">
                {legal.oked.length
                  ? legal.oked.map((entry) => (
                      <li key={entry.code} className="break-words [overflow-wrap:anywhere]">
                        <span className="font-mono">{entry.code}</span>
                        {entry.name ? ` — ${entry.name}` : ""}
                      </li>
                    ))
                  : "—"}
              </ul>
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
