import {
  displayCompleteness,
  type OwnProfile,
  type OwnSectionsOverview,
  type ProfileSubmissionState,
} from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { Building2Icon, ChevronRightIcon } from "lucide-react";
import { Link } from "react-router";
import { useTranslations } from "use-intl";
import { PageTitle } from "@/components/app/page-title";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { sectionPath, useOwnSections, useSubmissionState } from "@/features/profile/profile-data";
import { SubmissionWorkflow } from "@/features/profile/submission-workflow";
import { SurveyOwnRequestCard } from "@/features/site-survey/own-request";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";

/** MAN-21 / MAN-41: seven saved sections and the manufacturer submission workflow. */
export function ProfilePage() {
  const nav = useTranslations("nav");
  const t = useTranslations("profile");
  const editor = useTranslations("profileEditor");
  const common = useTranslations("common");
  const format = useFormat();
  const profile = useQuery({ queryKey: ["profile", "own"], queryFn: () => api<OwnProfile>("/v1/profiles/own") });
  const overview = useOwnSections();
  const submission = useSubmissionState();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageTitle title={nav("profile")} />
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <Building2Icon className="size-6 text-primary" />
        {nav("profile")}
      </h1>
      {(profile.isError || overview.isError) && !(profile.data && overview.data) ? (
        <Alert variant="destructive">
          <AlertDescription>{t("loadError")}</AlertDescription>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void profile.refetch();
              void overview.refetch();
            }}
          >
            {common("retry")}
          </Button>
        </Alert>
      ) : profile.data && overview.data ? (
        <>
          <ProfileView profile={profile.data} overview={overview.data} state={submission.data} />
          <SurveyOwnRequestCard currentProfile={profile.data} />
          <SubmissionWorkflow
            overview={overview.data}
            state={submission.data}
            stateError={submission.isError || profile.isError || overview.isError}
            reload={async () => {
              const results = await Promise.allSettled([
                profile.refetch({ throwOnError: true }),
                overview.refetch({ throwOnError: true }),
                submission.refetch({ throwOnError: true }),
              ]);
              const failed = results.find((result) => result.status === "rejected");
              if (failed?.status === "rejected") throw failed.reason;
            }}
          />
          <p className="text-sm text-muted-foreground">{editor("overviewHint")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {overview.data.sections.map((section) => (
              <Card key={section.kind} className={!section.available ? "bg-muted/30" : undefined}>
                <CardContent className="flex h-full flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold">{editor(`sections.${section.kind}`)}</h2>
                    <Badge variant="outline">
                      {section.available
                        ? `${format.number(displayCompleteness(section.completeness.percent))} %`
                        : editor("soon")}
                    </Badge>
                  </div>
                  {section.available ? (
                    <>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${section.completeness.percent}%` }}
                        />
                      </div>
                      <Link
                        className={cn(buttonVariants({ variant: "outline" }), "mt-auto justify-between")}
                        to={sectionPath(section.kind)}
                      >
                        {editor("openSection")}
                        <ChevronRightIcon className="size-4" />
                      </Link>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {editor(section.kind === "production" ? "optionalSoon" : "requiredSoon")}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <Skeleton className="h-96" />
      )}
      <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
        <p>{t("accountHint")}</p>
        <Link className={cn(buttonVariants({ variant: "outline" }))} to="/account">
          {nav("account")}
        </Link>
      </div>
    </div>
  );
}

function ProfileView({
  profile,
  overview,
  state,
}: {
  profile: OwnProfile;
  overview: OwnSectionsOverview;
  state?: ProfileSubmissionState;
}) {
  const t = useTranslations("profile");
  const editor = useTranslations("profileEditor");
  const catalog = useTranslations("catalog");
  const format = useFormat();
  const values = [
    [t("company"), profile.organizationName],
    [t("bin"), profile.bin],
    [t("completeness"), `${format.number(displayCompleteness(overview.completenessPct))} %`],
    [t("updateStatus"), profile.updateStatus ? catalog(`status.${profile.updateStatus}`) : t("notVerifiedYet")],
    [t("tier"), profile.tier ? catalog(`tierValue.${profile.tier}`) : t("notVerifiedYet")],
    [t("registeredAt"), format.date(profile.registeredAt)],
    [t("verifiedAt"), format.date(profile.verifiedAt)],
  ];
  return (
    <Card>
      <CardContent>
        <dl className="grid gap-3 text-sm">
          <div className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <dt className="text-muted-foreground">{t("status")}</dt>
            <dd className="flex flex-wrap gap-2">
              <Badge>{t(`statusValue.${overview.profileStatus}`)}</Badge>
              {(state?.hasUnsubmittedChanges ?? overview.sections.some((section) => section.hasWorkingChanges)) ? (
                <Badge variant="outline">{editor("unsubmitted")}</Badge>
              ) : overview.hasPendingChanges || (state?.profileStatus === "verified" && state.activeAssignmentId) ? (
                <Badge variant="outline">{t("pendingChanges")}</Badge>
              ) : null}
            </dd>
          </div>
          {values.map(([label, value]) => (
            <div key={label} className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
