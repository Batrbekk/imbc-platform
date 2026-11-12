// Файлы STR и KTRE (Release 2): ADM-15, FC-08 — загрузить, заменить, удалить; файл не принадлежит оператору.
import { COMMODITY_GROUPS, type CommodityGroup } from "@imbc/contracts";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmAction, FileRow, ProtoPage } from "@/prototype/components";
import type { FileRef, TechFile } from "@/prototype/data";
import { localized, useDictionary } from "@/prototype/i18n";
import { newId, useProto, useProtoUpdate } from "@/prototype/store";

import { useAdminAccountId } from "./actor";
import { ChoiceField, TextField } from "./fields";
import { sharedTexts, TechFilesView } from "./shared";
import { techFilesTexts } from "./tech-files-texts";

const KIND_LABEL: Record<TechFile["kind"], string> = { str: "STR", ktre: "KTRE" };
const isPdf = (file: FileRef) => file.name.toLowerCase().endsWith(".pdf");

export function TechFilesScreen() {
  const t = useDictionary(techFilesTexts);
  const update = useProtoUpdate();
  const adminId = useAdminAccountId();
  const files = useProto((s) => s.techFiles);
  const [error, setError] = useState(false);

  /** Загрузка в пустое место или замена (ADM-15). */
  const upload = (
    target: { group: CommodityGroup; product: string; tnved: string; existing: TechFile | null },
    kind: TechFile["kind"],
    file: FileRef,
  ) => {
    if (!isPdf(file)) {
      setError(true);
      return;
    }
    setError(false);
    const id = target.existing?.id ?? newId("tf");
    update(
      {
        action: target.existing ? "tech_file.replace" : "tech_file.upload",
        subject: { type: "tech_file", id, label: `${KIND_LABEL[kind]} · ${target.product}` },
        summary: localized(techFilesTexts, target.existing ? "replaced" : "uploaded", {
          kind: KIND_LABEL[kind],
          product: target.product,
          file: file.name,
        }),
      },
      (draft) => {
        const existing = draft.techFiles.find((f) => f.id === id);
        if (existing) {
          existing.file = file;
          existing.uploadedBy = adminId;
        } else {
          draft.techFiles.push({
            id,
            group: target.group,
            product: target.product,
            tnved: target.tnved,
            kind,
            file,
            uploadedBy: adminId,
          });
        }
      },
    );
  };

  return (
    <ProtoPage
      title={t("title")}
      description={t("description")}
      release2
      actions={<AddProduct onAdd={(target, kind, file) => upload({ ...target, existing: null }, kind, file)} />}
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{t("notPdf")}</AlertDescription>
        </Alert>
      )}
      <TechFilesView
        files={files}
        readOnly={false}
        onUpload={(product, kind, file) => upload({ ...product, existing: product[kind] }, kind, file)}
        removeAction={(file) => <RemoveFile file={file} />}
      />
    </ProtoPage>
  );
}

function RemoveFile({ file }: { file: TechFile }) {
  const t = useDictionary(techFilesTexts);
  const update = useProtoUpdate();
  const values = { kind: KIND_LABEL[file.kind], product: file.product };
  return (
    <ConfirmAction
      variant="outline"
      size="sm"
      label={t("remove")}
      title={t("removeTitle", values)}
      description={t("removeDescription")}
      confirmLabel={t("remove")}
      onConfirm={() =>
        update(
          {
            action: "tech_file.remove",
            subject: { type: "tech_file", id: file.id, label: `${values.kind} · ${file.product}` },
            summary: localized(techFilesTexts, "removed", values),
          },
          (draft) => {
            draft.techFiles = draft.techFiles.filter((f) => f.id !== file.id);
          },
        )
      }
    />
  );
}

function AddProduct({
  onAdd,
}: {
  onAdd: (
    target: { group: CommodityGroup; product: string; tnved: string },
    kind: TechFile["kind"],
    file: FileRef,
  ) => void;
}) {
  const t = useDictionary(techFilesTexts);
  const shared = useDictionary(sharedTexts);
  const [group, setGroup] = useState<CommodityGroup>("A");
  const [product, setProduct] = useState("");
  const [tnved, setTnved] = useState("");
  const [kind, setKind] = useState<TechFile["kind"]>("str");
  const [file, setFile] = useState<FileRef | null>(null);
  const tnvedValid = /^\d{10}$/.test(tnved.trim());
  const fileValid = file !== null && isPdf(file);

  return (
    <ConfirmAction
      label={t("add")}
      title={t("addTitle")}
      confirmLabel={t("add")}
      confirmDisabled={!product.trim() || !tnvedValid || !fileValid}
      onConfirm={() => {
        onAdd({ group, product: product.trim(), tnved: tnved.trim() }, kind, file!);
        setProduct("");
        setTnved("");
        setFile(null);
      }}
    >
      <div className="flex flex-col gap-4">
        <ChoiceField
          label={t("group")}
          value={group}
          onChange={setGroup}
          options={COMMODITY_GROUPS.map((g) => ({ value: g, label: shared("tfGroup", { group: g }) }))}
        />
        <TextField label={t("product")} value={product} onChange={setProduct} />
        <TextField label={t("tnved")} value={tnved} onChange={setTnved} error={tnvedValid ? null : t("tnvedInvalid")} />
        <ChoiceField
          label={t("kind")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "str", label: "STR" },
            { value: "ktre", label: "KTRE" },
          ]}
        />
        <FileRow label={t("file")} file={file} onSelect={setFile} />
        {file && !fileValid && <p className="text-sm text-destructive">{t("notPdf")}</p>}
      </div>
    </ConfirmAction>
  );
}
