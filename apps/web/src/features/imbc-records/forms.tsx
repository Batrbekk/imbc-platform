import {
  imbcNoteCreateSchema,
  imbcNoteUpdateSchema,
  imbcEngagementPutSchema,
  imbcProductContextPutSchema,
  type ImbcNoteRead,
  type ImbcEngagementRead,
  type ImbcProductContextRead,
} from "@imbc/contracts";
import { useCallback, useEffect, useState, type RefObject } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFormat } from "@/i18n/format";
import { RecordEditor, type EditorFields } from "./editor";
import { ReferencePicker } from "./references";
import { saveNote, saveEngagement, saveContext, type RecordScope } from "./api";
type Shared<R> = {
  scope: RecordScope;
  actorId: string;
  initial: R | null;
  blocked: boolean;
  lost: (error: unknown) => void;
  close: () => void;
  saved: (row: R) => void;
  reload: () => Promise<R | null>;
  focus: RefObject<HTMLButtonElement | null>;
};
function Choice<T extends string | boolean>({
  id,
  label,
  value,
  choices,
  disabled,
  change,
}: {
  id: string;
  label: string;
  value: T | null;
  choices: { value: T | null; label: string }[];
  disabled: boolean;
  change: (v: T | null) => void;
}) {
  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select items={choices} value={value} disabled={disabled} onValueChange={(v) => change(v as T | null)}>
        <SelectTrigger id={id} className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {choices.map((row) => (
            <SelectItem key={String(row.value)} value={row.value}>
              {row.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
export function NoteEditor(props: Shared<ImbcNoteRead>) {
  const t = useTranslations("imbcRecords");
  return (
    <RecordEditor
      {...props}
      title={t(props.initial ? "editNote" : "newNote")}
      values={(row) => ({ body: row?.body ?? "" })}
      payload={(draft, row) => (row ? { body: draft.body, expectedUpdatedAt: row.updatedAt } : { body: draft.body })}
      schema={z.union([imbcNoteUpdateSchema, imbcNoteCreateSchema])}
      save={(body, key) => saveNote(props.scope, props.initial?.id ?? null, body, key)}
      fields={({ draft, locked, errors, update }) => (
        <>
          {props.initial && (
            <p className="text-sm">
              {t("noteKind")}: {t(`noteKinds.${props.initial.kind}`)}
            </p>
          )}
          <Field className="min-w-0">
            <FieldLabel htmlFor="imbc-note-body">{t("noteBody")}</FieldLabel>
            <Textarea
              id="imbc-note-body"
              rows={8}
              maxLength={20000}
              className="min-w-0"
              value={draft.body}
              disabled={locked}
              onChange={(event) => update({ body: event.target.value })}
            />
            {errors.includes("body") && <FieldError>{t("invalidField")}</FieldError>}
          </Field>
        </>
      )}
    />
  );
}
type EngagementDraft = {
  receiptConfirmed: boolean | null;
  response: "interested" | "not_interested" | null;
  responseSummary: string;
  readyForSiteVisit: boolean | null;
  addedToImbcYear: string;
  folderUrl: string;
  sourceEntryIds: string[];
  eoiEvents: { id: string; sentOn: string }[];
};
const engagementValues = (row: ImbcEngagementRead | null): EngagementDraft => ({
  receiptConfirmed: row?.receiptConfirmed ?? null,
  response: row?.response ?? null,
  responseSummary: row?.responseSummary ?? "",
  readyForSiteVisit: row?.readyForSiteVisit ?? null,
  addedToImbcYear:
    row?.addedToImbcYear === undefined || row.addedToImbcYear === null ? "" : String(row.addedToImbcYear),
  folderUrl: row?.folderUrl ?? "",
  sourceEntryIds: row?.sourceEntryIds ?? [],
  eoiEvents: row?.eoiEvents.map(({ id, sentOn }) => ({ id, sentOn })) ?? [],
});
function EngagementFields(
  props: EditorFields<EngagementDraft, ImbcEngagementRead> & {
    scope: RecordScope;
    actorId: string;
    lost: (error: unknown) => void;
  },
) {
  const t = useTranslations("imbcRecords"),
    f = useFormat();
  const truth = [
      { value: null, label: t("unknown") },
      { value: true, label: t("yes") },
      { value: false, label: t("no") },
    ],
    response = [
      { value: null, label: t("unknown") },
      ...(["interested", "not_interested"] as const).map((value) => ({ value, label: t(`responses.${value}`) })),
    ];
  return (
    <>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Choice
          id="imbc-receipt"
          label={t("receiptConfirmed")}
          value={props.draft.receiptConfirmed}
          choices={truth}
          disabled={props.locked}
          change={(receiptConfirmed) => props.update({ receiptConfirmed })}
        />
        <Choice
          id="imbc-response"
          label={t("response")}
          value={props.draft.response}
          choices={response}
          disabled={props.locked}
          change={(response) => props.update({ response })}
        />
        <Choice
          id="imbc-ready"
          label={t("readyForSiteVisit")}
          value={props.draft.readyForSiteVisit}
          choices={truth}
          disabled={props.locked}
          change={(readyForSiteVisit) => props.update({ readyForSiteVisit })}
        />
        <Field className="min-w-0">
          <FieldLabel htmlFor="imbc-year">{t("addedToImbcYear")}</FieldLabel>
          <Input
            id="imbc-year"
            inputMode="numeric"
            value={props.draft.addedToImbcYear}
            disabled={props.locked}
            onChange={(event) => props.update({ addedToImbcYear: event.target.value })}
          />
          {props.errors.includes("addedToImbcYear") && <FieldError>{t("invalidYear")}</FieldError>}
        </Field>
      </div>
      <Field className="min-w-0">
        <FieldLabel htmlFor="imbc-response-summary">{t("responseSummary")}</FieldLabel>
        <Textarea
          id="imbc-response-summary"
          rows={5}
          maxLength={20000}
          value={props.draft.responseSummary}
          disabled={props.locked}
          onChange={(event) => props.update({ responseSummary: event.target.value })}
        />
        {props.errors.includes("responseSummary") && <FieldError>{t("invalidField")}</FieldError>}
      </Field>
      <Field className="min-w-0">
        <FieldLabel htmlFor="imbc-folder">{t("folderUrl")}</FieldLabel>
        <Input
          id="imbc-folder"
          type="url"
          maxLength={2048}
          value={props.draft.folderUrl}
          disabled={props.locked}
          onChange={(event) => props.update({ folderUrl: event.target.value })}
        />
        {props.errors.includes("folderUrl") && <FieldError>{t("invalidUrl")}</FieldError>}
      </Field>
      <Field className="min-w-0">
        <FieldLabel>{t("acquisitionSources")}</FieldLabel>
        <ReferencePicker
          {...props.scope}
          actorId={props.actorId}
          code="acquisition_source"
          ids={props.draft.sourceEntryIds}
          baselineIds={props.baseline?.sourceEntryIds ?? []}
          multiple
          disabled={props.locked}
          change={(sourceEntryIds) => props.update({ sourceEntryIds })}
          blocking={props.blocking}
          lost={props.lost}
        />
      </Field>
      <section className="min-w-0 space-y-3">
        <h3 className="font-medium">{t("historicalEoiDates")}</h3>
        <p className="text-sm text-muted-foreground">{t("historicalDatesHint")}</p>
        {!props.draft.eoiEvents.length && <p className="text-sm">{t("noHistoricalDates")}</p>}
        {props.draft.eoiEvents.map((event, index) => {
          const original = props.baseline?.eoiEvents.find((row) => row.id === event.id);
          return (
            <div key={event.id} className="min-w-0 space-y-2 rounded-lg border p-3">
              <Field className="min-w-0">
                <FieldLabel htmlFor={`imbc-eoi-${event.id}`}>{t("sentOn", { number: f.number(index + 1) })}</FieldLabel>
                <Input
                  id={`imbc-eoi-${event.id}`}
                  type="date"
                  value={event.sentOn}
                  disabled={props.locked}
                  onChange={(change) =>
                    props.update({
                      eoiEvents: props.draft.eoiEvents.map((row) =>
                        row.id === event.id ? { ...row, sentOn: change.target.value } : row,
                      ),
                    })
                  }
                />
              </Field>
              {original ? (
                <p className="text-xs text-muted-foreground">
                  {t("retainedDate")}: {original.recordedByName ?? t("unknownAuthor")} ·{" "}
                  {f.dateTime(original.createdAt)}
                </p>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={props.locked}
                  onClick={() =>
                    props.update({ eoiEvents: props.draft.eoiEvents.filter((row) => row.id !== event.id) })
                  }
                >
                  {t("removeUnsavedDate")}
                </Button>
              )}
            </div>
          );
        })}
        {props.errors.includes("eoiEvents") && <FieldError>{t("invalidDates")}</FieldError>}
        <Button
          type="button"
          variant="outline"
          disabled={props.locked || props.draft.eoiEvents.length >= 200}
          onClick={() =>
            props.update({ eoiEvents: [...props.draft.eoiEvents, { id: crypto.randomUUID(), sentOn: "" }] })
          }
        >
          {t("addHistoricalDate")}
        </Button>
      </section>
    </>
  );
}
export function EngagementEditor(props: Shared<ImbcEngagementRead>) {
  const t = useTranslations("imbcRecords");
  return (
    <RecordEditor
      {...props}
      title={t("editEngagement")}
      values={engagementValues}
      schema={imbcEngagementPutSchema}
      payload={(draft, row) => ({
        ...draft,
        responseSummary: draft.responseSummary || null,
        folderUrl: draft.folderUrl || null,
        addedToImbcYear:
          draft.addedToImbcYear === ""
            ? null
            : /^\d{1,4}$/.test(draft.addedToImbcYear)
              ? Number(draft.addedToImbcYear)
              : NaN,
        expectedUpdatedAt: row?.updatedAt ?? null,
      })}
      rebase={(draft, next) => ({
        ...draft,
        eoiEvents: [
          ...draft.eoiEvents,
          ...(next?.eoiEvents ?? [])
            .filter((event) => !draft.eoiEvents.some((old) => old.id === event.id))
            .map(({ id, sentOn }) => ({ id, sentOn })),
        ],
      })}
      save={(body, key) => saveEngagement(props.scope, body, key)}
      fields={(fields) => (
        <EngagementFields {...fields} scope={props.scope} actorId={props.actorId} lost={props.lost} />
      )}
    />
  );
}
function ContextFields(
  props: EditorFields<{ programmeId: string | null; priorityId: string | null }, ImbcProductContextRead> & {
    scope: RecordScope;
    actorId: string;
    lost: (error: unknown) => void;
  },
) {
  const [blocked, setBlocked] = useState({ programme: false, priority: false });
  const programme = useCallback(
      (value: boolean) => setBlocked((old) => (old.programme === value ? old : { ...old, programme: value })),
      [],
    ),
    priority = useCallback(
      (value: boolean) => setBlocked((old) => (old.priority === value ? old : { ...old, priority: value })),
      [],
    );
  const aggregate = blocked.programme || blocked.priority;
  // Both reference lookups must complete before a save can use their selected IDs.
  return <ContextFieldsBody {...props} programme={programme} priority={priority} aggregate={aggregate} />;
}
function ContextFieldsBody(
  props: Parameters<typeof ContextFields>[0] & {
    programme: (v: boolean) => void;
    priority: (v: boolean) => void;
    aggregate: boolean;
  },
) {
  const t = useTranslations("imbcRecords");
  return (
    <>
      {/* The aggregate is reported by a separate effect to avoid render-time state writes. */}
      <ReferenceGate value={props.aggregate} report={props.blocking} />
      {(["programme", "priority"] as const).map((field) => (
        <Field key={field} className="min-w-0">
          <FieldLabel>{t(field)}</FieldLabel>
          <ReferencePicker
            {...props.scope}
            actorId={props.actorId}
            code={field === "programme" ? "programme" : "imbc_priority"}
            ids={props.draft[`${field}Id`] ? [props.draft[`${field}Id`]!] : []}
            baselineIds={props.baseline?.[`${field}Id`] ? [props.baseline[`${field}Id`]!] : []}
            disabled={props.locked}
            lost={props.lost}
            change={(ids) => props.update({ [`${field}Id`]: ids[0] ?? null })}
            blocking={props[field]}
          />
        </Field>
      ))}
    </>
  );
}
function ReferenceGate({ value, report }: { value: boolean; report: (v: boolean) => void }) {
  useEffect(() => {
    report(value);
    return () => report(false);
  }, [value, report]);
  return null;
}
export function ContextEditor(
  props: Shared<ImbcProductContextRead> & { productIdentityId: string; productName: string },
) {
  const t = useTranslations("imbcRecords");
  return (
    <RecordEditor
      {...props}
      title={t("editProductContext")}
      values={(row) => ({ programmeId: row?.programmeId ?? null, priorityId: row?.priorityId ?? null })}
      schema={imbcProductContextPutSchema}
      payload={(draft, row) => ({ ...draft, expectedUpdatedAt: row?.updatedAt ?? null })}
      save={(body, key) => saveContext(props.scope, props.productIdentityId, body, key)}
      fields={(fields) => (
        <>
          <h3 className="whitespace-pre-wrap wrap-anywhere font-medium">{props.productName}</h3>
          <ContextFields {...fields} scope={props.scope} actorId={props.actorId} lost={props.lost} />
        </>
      )}
    />
  );
}
