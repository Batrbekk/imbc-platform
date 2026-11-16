import {
  SECTION_KINDS,
  profileSubmitInputSchema,
  profileSubmitResultSchema,
  profileUnlockResultSchema,
  type OwnSectionsOverview,
  type ProfileSubmissionState,
  type ProfileSubmitInput,
  type ProfileUnlockInput,
} from "@imbc/contracts";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslations } from "use-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { CurrentSubmissionRequirements } from "./current-requirements";
import { sectionPath } from "./profile-data";

type Action = { kind: "send"; request: ProfileSubmitInput } | { kind: "unlock"; request: ProfileUnlockInput };
const staleCodes = [
  "section_changed",
  "profile_locked",
  "assignment_changed",
  "operation_conflict",
  "profile_no_changes",
];
const evidenceCodes = [
  "profile_incomplete",
  "submission_requirements_changed",
  "submission_file_unavailable",
  "submission_graph_invalid",
];

/** A confirmation owns its viewed vector. Refetches never rewrite an in-flight or retryable request. */
export function SubmissionWorkflow({
  overview,
  state,
  stateError,
  reload,
}: {
  overview: OwnSectionsOverview;
  state: ProfileSubmissionState | undefined;
  stateError: boolean;
  reload: () => Promise<void>;
}) {
  const t = useTranslations("profileSubmission");
  const client = useQueryClient();
  // Keep the stale barrier through dialog dismissal and route remounts within this session.
  const reloadBarrierKey = ["profile", "submission-reload-required", overview.profileId] as const;
  const reloadBarrier = useQuery<boolean>({
    queryKey: reloadBarrierKey,
    queryFn: skipToken,
    initialData: false,
    gcTime: Infinity,
  });
  const requiresReread = reloadBarrier.data;
  const [reloadFailed, setReloadFailed] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [accurate, setAccurate] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [success, setSuccess] = useState<"sent" | "unlocked" | null>(null);
  const allAvailable = SECTION_KINDS.every((kind) =>
    overview.sections.some((section) => section.kind === kind && section.available && section.revisionId),
  );
  const active = state?.activeAssignmentId;
  const sendAllowed = Boolean(
    state && !requiresReread && !active && (state.profileStatus !== "verified" || state.hasUnsubmittedChanges),
  );
  const retryable = failure !== null && (!(failure instanceof ApiError) || failure.status >= 500);
  const needsReload = requiresReread;

  function openSend() {
    if (busyRef.current || !sendAllowed || !allAvailable) return;
    const request = profileSubmitInputSchema.safeParse({
      operationKey: crypto.randomUUID(),
      accuracyConfirmed: true,
      expectedSections: overview.sections.map(({ kind, revisionId, editVersion }) => ({
        kind,
        revisionId,
        editVersion,
      })),
    });
    if (!request.success) {
      client.setQueryData(reloadBarrierKey, true);
      setFailure(new ApiError(409, "section_changed", ""));
      return;
    }
    setAccurate(false);
    setFailure(null);
    setSuccess(null);
    setAction({ kind: "send", request: request.data });
  }
  function openUnlock() {
    if (busyRef.current || requiresReread || !active) return;
    setFailure(null);
    setSuccess(null);
    setAction({ kind: "unlock", request: { operationKey: crypto.randomUUID(), expectedAssignmentId: active } });
  }
  async function reread() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setAction(null);
    setAccurate(false);
    setFailure(null);
    setSuccess(null);
    setReloadFailed(false);
    client.setQueryData(reloadBarrierKey, true);
    try {
      await reload();
      client.setQueryData(reloadBarrierKey, false);
    } catch {
      setReloadFailed(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (
      !action ||
      busyRef.current ||
      requiresReread ||
      (action.kind === "send" && !accurate) ||
      (failure && !retryable)
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    try {
      if (action.kind === "send") {
        const result = profileSubmitResultSchema.parse(
          await api<unknown>("/v1/profiles/own/submit", { method: "POST", json: action.request }),
        );
        client.setQueryData(["profile", "submission"], {
          profileId: result.profileId,
          profileStatus: result.profileStatus,
          activeAssignmentId: result.assignmentId,
          hasUnsubmittedChanges: false,
        } satisfies ProfileSubmissionState);
        setSuccess("sent");
      } else {
        profileUnlockResultSchema.parse(
          await api<unknown>("/v1/profiles/own/unlock", { method: "POST", json: action.request }),
        );
        setSuccess("unlocked");
      }
      setAction(null);
      setAccurate(false);
      await client.invalidateQueries({ queryKey: ["profile"] });
    } catch (error) {
      if (error instanceof ApiError && staleCodes.includes(error.code)) client.setQueryData(reloadBarrierKey, true);
      setFailure(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function errorContent() {
    if (!failure && !requiresReread) return null;
    const code = failure instanceof ApiError ? failure.code : "network";
    const label =
      requiresReread || staleCodes.includes(code)
        ? "stale"
        : evidenceCodes.includes(code)
          ? code
          : code === "forbidden" || code === "unauthorized"
            ? "forbidden"
            : retryable
              ? "network"
              : "failed";
    const missing = failure instanceof ApiError ? [...new Set(failure.submissionMissing.map((item) => item.kind))] : [];
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <p>{t(`errors.${label}`)}</p>
          {reloadFailed && <p className="mt-2">{t("reloadError")}</p>}
          {(missing.length > 0 || (failure instanceof ApiError && failure.submissionRequirements.length > 0)) && (
            <SubmissionMissing failure={failure as ApiError} onNavigate={() => setAction(null)} />
          )}
          {needsReload && (
            <Button className="mt-3" variant="outline" disabled={busy} onClick={() => void reread()}>
              {t("reload")}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <section aria-label={t("actions")} className="space-y-3">
      {stateError && !requiresReread ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t("stateError")}
            <Button className="mt-2" variant="outline" disabled={busy} onClick={() => void reread()}>
              {t("reload")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{active ? t("lockedHint") : t("savedHint")}</p>
          <div className="flex flex-wrap gap-3">
            {active ? (
              <Button variant="outline" disabled={busy || requiresReread} onClick={openUnlock}>
                {t("unlock")}
              </Button>
            ) : (
              <Button disabled={busy || !sendAllowed || !allAvailable} onClick={openSend}>
                {t(state?.profileStatus === "verified" ? "sendChanges" : "send")}
              </Button>
            )}
          </div>
        </>
      )}
      {success && (
        <p role="status" className="text-sm text-primary">
          {t(success)}
        </p>
      )}
      {!action && errorContent()}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !busyRef.current) setAction(null);
        }}
      >
        <DialogContent showCloseButton={false} className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t(action?.kind === "unlock" ? "unlockTitle" : "sendTitle")}</DialogTitle>
            <DialogDescription>
              {t(action?.kind === "unlock" ? "unlockDescription" : "sendDescription")}
            </DialogDescription>
          </DialogHeader>
          {action?.kind === "send" && (
            <Field orientation="horizontal">
              <Checkbox id="profile-accuracy" checked={accurate} disabled={busy} onCheckedChange={setAccurate} />
              <FieldContent>
                <FieldLabel htmlFor="profile-accuracy">{t("accuracy")}</FieldLabel>
              </FieldContent>
            </Field>
          )}
          {errorContent()}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setAction(null)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={
                busy || requiresReread || (action?.kind === "send" && !accurate) || Boolean(failure && !retryable)
              }
              onClick={() => void confirm()}
            >
              {t(
                busy ? "processing" : retryable ? "retry" : action?.kind === "unlock" ? "confirmUnlock" : "confirmSend",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SubmissionMissing({ failure, onNavigate }: { failure: ApiError; onNavigate: () => void }) {
  const t = useTranslations("profileSubmission");
  const editor = useTranslations("profileEditor");
  const kinds = SECTION_KINDS.filter(
    (kind) =>
      failure.submissionMissing.some((item) => item.kind === kind) ||
      failure.submissionRequirements.some((item) => item.kind === kind),
  );
  return (
    <div className="mt-3 space-y-3">
      <p>{t("missingHint")}</p>
      <ul className="list-inside list-disc space-y-2">
        {kinds.map((kind) => (
          <li key={kind}>
            <Link className="underline underline-offset-4" to={sectionPath(kind)} onClick={onNavigate}>
              {editor(`sections.${kind}`)}
            </Link>
            {(kind === "documents" || kind === "certificates") &&
              failure.submissionRequirements
                .filter((item) => item.kind === kind)
                .map((item, index) => (
                  <CurrentSubmissionRequirements key={index} kind={kind} ids={item.requiredTypeIds} />
                ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
