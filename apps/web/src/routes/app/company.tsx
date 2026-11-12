import { can, type CompanyPage as Company } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useLocale, useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { api, ApiError } from "@/lib/api";
import { useMe } from "@/lib/session";

/**
 * Страница компании из каталога, только для чтения (OPR-09, OPR-10, OPR-11). Данные — строка проекции
 * видимых профилей; права решает сервер, интерфейс только прячет focal point без `focal_point.read`
 * (GEN-08, GEN-13). «Назад к каталогу» возвращает фильтры, с которыми открыли страницу.
 */
export function CompanyPage() {
  const t = useTranslations("company");
  const nav = useTranslations("nav");
  const common = useTranslations("common");
  const locale = useLocale();
  const { profileId = "" } = useParams();
  const { state } = useLocation();
  const from: unknown = (state as { from?: unknown } | null)?.from;
  const back = `/catalog${typeof from === "string" && from.startsWith("?") ? from : ""}`;

  const result = useQuery({
    queryKey: ["company", profileId],
    queryFn: () => api<Company>(`/v1/catalog/companies/${encodeURIComponent(profileId)}`),
  });
  const company = result.data;
  // 400 — id в адресе не uuid: для пользователя это тоже «не найдено», повтор не поможет.
  const notFound = result.error instanceof ApiError && (result.error.status === 404 || result.error.status === 400);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageTitle title={company ? names(company, locale)[0] : t("title")} />
      <div>
        <Link className={buttonVariants({ variant: "ghost", size: "sm" })} to={back}>
          <ArrowLeftIcon />
          {t("back")}
        </Link>
      </div>

      {company ? (
        <CompanyView company={company} />
      ) : notFound ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{t("notFound")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link className={buttonVariants({ variant: "outline" })} to="/catalog">
              {nav("catalog")}
            </Link>
          </EmptyContent>
        </Empty>
      ) : result.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t("loadError")}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void result.refetch()}>
              {common("retry")}
            </Button>
          </AlertAction>
        </Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-9 w-2/3" />
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Название на языке интерфейса и второе: en — nameEn, kk и ru — nameRu. */
function names(company: Company, locale: string): [string, string] {
  return locale === "en" ? [company.nameEn, company.nameRu] : [company.nameRu, company.nameEn];
}

function CompanyView({ company }: { company: Company }) {
  const t = useTranslations("company");
  const [name, otherName] = names(company, useLocale());
  const catalog = useTranslations("catalog");
  const common = useTranslations("common");
  const format = useFormat();
  const role = useMe().data?.user.role;
  const yesNo = (value: boolean) => (value ? common("yes") : common("no"));
  const orNone = (value: string | null) => value ?? t("notProvided");
  // Основной код ТН ВЭД — первым.
  const tnved = company.mainTnved
    ? [company.mainTnved, ...company.tnvedCodes.filter((code) => code !== company.mainTnved)]
    : company.tnvedCodes;
  // Наблюдатель не получает ключа focalPoint (GEN-13); строку прячет и матрица прав.
  const showFocalPoint = role !== undefined && can(role, "focal_point.read") !== null && "focalPoint" in company;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
        <p className="text-sm text-muted-foreground">{otherName}</p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Тир виден и наблюдателю (IMBC-22). */}
          <Badge variant="secondary">{catalog(`tierValue.${company.tier}`)}</Badge>
          <Badge variant={company.updateStatus === "active" ? "default" : "outline"}>
            {catalog(`status.${company.updateStatus}`)}
          </Badge>
          {/* Показаны последние проверенные значения (OPR-11). */}
          {company.pendingChanges && <Badge variant="outline">{t("pending")}</Badge>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("details")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <Field label={t("bin")}>
                <span className="font-mono">{company.bin}</span>
              </Field>
              <Field label={t("region")}>{company.region}</Field>
              <Field label={t("headcount")}>
                {company.headcountTotal === null ? t("notProvided") : format.number(company.headcountTotal)}
              </Field>
              <Field label={t("groups")}>
                <span className="flex flex-wrap gap-1">
                  {company.commodityGroups.map((group) => (
                    <Badge key={group} variant="secondary">
                      {catalog("groupValue", { group })}
                    </Badge>
                  ))}
                </span>
              </Field>
              <Field label={t("tnved")}>{tnved.join(", ") || t("notProvided")}</Field>
              <Field label={t("unifiedRegister")}>{yesNo(company.unifiedRegister)}</Field>
              <Field label={t("verifiedAt")}>{format.date(company.verifiedAt)}</Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("certificates")}</CardTitle>
          </CardHeader>
          <CardContent>
            {company.certificates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noCertificates")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("certType")}</TableHead>
                    <TableHead>{t("validUntil")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {company.certificates.map((certificate) => (
                    <TableRow key={certificate.type}>
                      <TableCell>{certificate.type}</TableCell>
                      <TableCell>{format.date(certificate.validUntil)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("imbc")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <Field label={t("siteSurveyed")}>{yesNo(company.siteSurveyed)}</Field>
              {/* Сколько из трёх крупных операторов, без названий (OPR-10, OPR-12). */}
              <Field label={t("worksWith")}>
                {t("worksWithValue", { count: format.number(company.worksWithCount) })}
              </Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("contacts")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <Field label={t("companyPhone")}>{orNone(company.companyPhone)}</Field>
              <Field label={t("companyEmail")}>{orNone(company.companyEmail)}</Field>
              {showFocalPoint && (
                <Field label={t("focalPoint")}>
                  {company.focalPoint ? (
                    <span className="flex flex-col">
                      <span className="font-medium">{company.focalPoint.fullName}</span>
                      <span className="text-muted-foreground">{company.focalPoint.position}</span>
                      <span>{company.focalPoint.email}</span>
                      <span>{company.focalPoint.phone}</span>
                    </span>
                  ) : (
                    t("notProvided")
                  )}
                </Field>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Строка «подпись — значение» карточки. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
