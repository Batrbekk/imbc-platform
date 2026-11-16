import { fieldId, moveRow, useFieldMessage, useProfileChoices } from "./form-data";
import type { ContactsWrite } from "@imbc/contracts";
import { PlusIcon } from "lucide-react";
import { useId } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldError, FieldLabel } from "@/components/ui/field";
import { useFormat } from "@/i18n/format";
import { ProfileChoiceField, ProfileRowActions, ProfileTextField } from "./form-fields";
import type { SectionFieldErrors } from "./section-draft";

type Contact = ContactsWrite["contacts"][number];
type RoleChoice = { value: string; label: string; disabled?: boolean };

export function ContactsForm({
  value,
  onChange,
  disabled,
  errors,
  onError,
}: {
  value: ContactsWrite;
  onChange: (value: ContactsWrite) => void;
  disabled: boolean;
  errors: SectionFieldErrors;
  onError: (path: string, code: string) => void;
}) {
  const t = useTranslations("profileEditor");
  const id = useId();
  const titleId = `${id}-contacts-title`;
  const hintId = `${id}-contacts-hint`;
  const roles = useProfileChoices("contact_role");

  function changeRows(contacts: Contact[]) {
    onChange({ ...value, contacts });
  }

  function changeContact(index: number, patch: Partial<Contact>) {
    changeRows(value.contacts.map((contact, position) => (position === index ? { ...contact, ...patch } : contact)));
  }

  function changeFocalPoint(index: number, checked: boolean) {
    if (checked && value.contacts.some((contact, position) => position !== index && contact.isFocalPoint)) {
      onError(`contacts.${index}.isFocalPoint`, "multiple_focal_points");
      return;
    }
    changeContact(index, { isFocalPoint: checked });
  }

  function addContact() {
    changeRows([
      ...value.contacts,
      {
        fullName: null,
        position: null,
        email: null,
        phone: null,
        roleId: null,
        isFocalPoint: false,
      },
    ]);
  }

  return (
    <section id={fieldId("contacts")} className="space-y-4" aria-labelledby={titleId} aria-describedby={hintId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-base font-medium">
          {t("contactsTitle")}
        </h2>
        <Button type="button" variant="outline" disabled={disabled} onClick={addContact}>
          <PlusIcon />
          {t("addContact")}
        </Button>
      </div>
      <p id={hintId} className="text-sm text-muted-foreground">
        {t("contactsHint")}
      </p>
      {roles.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          <p>{t("referenceLoadError")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={roles.isFetching}
            onClick={() => void roles.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      )}
      {value.contacts.map((contact, index) => (
        <ContactRow
          key={index}
          value={contact}
          index={index}
          count={value.contacts.length}
          hintId={hintId}
          disabled={disabled}
          errors={errors}
          choices={roles.choices}
          choicesDisabled={roles.isPending || roles.isError}
          onChange={(patch) => changeContact(index, patch)}
          onFocalChange={(checked) => changeFocalPoint(index, checked)}
          onMove={(to) => changeRows(moveRow(value.contacts, index, to))}
          onRemove={() => changeRows(value.contacts.filter((_, position) => position !== index))}
        />
      ))}
    </section>
  );
}

function ContactRow({
  value,
  index,
  count,
  hintId,
  disabled,
  errors,
  choices,
  choicesDisabled,
  onChange,
  onFocalChange,
  onMove,
  onRemove,
}: {
  value: Contact;
  index: number;
  count: number;
  hintId: string;
  disabled: boolean;
  errors: SectionFieldErrors;
  choices: readonly RoleChoice[];
  choicesDisabled: boolean;
  onChange: (patch: Partial<Contact>) => void;
  onFocalChange: (checked: boolean) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("profileEditor");
  const format = useFormat();
  const path = `contacts.${index}`;
  const titleId = `${fieldId(path)}-title`;
  const focalPath = `${path}.isFocalPoint`;
  const focalError = useFieldMessage(errors[focalPath]);
  const focalErrorId = `${fieldId(focalPath)}-error`;
  const selectedRole = choices.some((choice) => choice.value === value.roleId) ? value.roleId : null;

  return (
    <Card size="sm" className="min-w-0" role="group" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>{t("contactNumber", { number: format.number(index + 1) })}</CardTitle>
        <CardAction>
          <ProfileRowActions index={index} count={count} disabled={disabled} onMove={onMove} onRemove={onRemove} />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <ProfileTextField
          path={`${path}.fullName`}
          label={t("fullName")}
          value={value.fullName}
          onChange={(fullName) => onChange({ fullName })}
          disabled={disabled}
          errors={errors}
        />
        <ProfileTextField
          path={`${path}.position`}
          label={t("position")}
          value={value.position}
          onChange={(position) => onChange({ position })}
          disabled={disabled}
          errors={errors}
        />
        <ProfileTextField
          path={`${path}.email`}
          label={t("email")}
          type="email"
          value={value.email}
          onChange={(email) => onChange({ email })}
          disabled={disabled}
          errors={errors}
        />
        <ProfileTextField
          path={`${path}.phone`}
          label={t("phone")}
          type="tel"
          value={value.phone}
          onChange={(phone) => onChange({ phone })}
          disabled={disabled}
          errors={errors}
          hint={t("phoneHint")}
        />
        <ProfileChoiceField
          path={`${path}.roleId`}
          label={t("role")}
          value={selectedRole}
          onChange={(roleId) => onChange({ roleId })}
          disabled={disabled || choicesDisabled}
          errors={errors}
          choices={choices}
        />
        <Field orientation="horizontal" data-invalid={Boolean(focalError)} className="sm:self-end">
          <Checkbox
            id={fieldId(focalPath)}
            checked={value.isFocalPoint}
            onCheckedChange={onFocalChange}
            disabled={disabled}
            aria-invalid={Boolean(focalError)}
            aria-describedby={focalError ? `${hintId} ${focalErrorId}` : hintId}
          />
          <FieldContent>
            <FieldLabel htmlFor={fieldId(focalPath)}>{t("focalPoint")}</FieldLabel>
            {focalError && <FieldError id={focalErrorId}>{focalError}</FieldError>}
          </FieldContent>
        </Field>
      </CardContent>
    </Card>
  );
}
