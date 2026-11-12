// Формы секций «Продукты» и «Производство». MAN-23, MAN-24, MAN-25, MAN-26…MAN-32.
import { CAPACITY_UNITS, COMMODITY_GROUPS, type CapacityUnit, type CommodityGroup } from "@imbc/contracts";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { useFormat } from "@/i18n/format";

import { FileRow } from "../components";
import type { Equipment, ProductLine } from "../data";
import { useDictionary } from "../i18n";
import { newId } from "../store";
import {
  AddButton,
  CheckField,
  ChoiceField,
  FieldGrid,
  FileSlot,
  NumberField,
  RowCard,
  SaveBar,
  TextField,
} from "./fields";
import type { FormProps } from "./model";
import { useReference, withCurrent } from "./reference";
import { texts } from "./texts";

const emptyLine = (): ProductLine => ({
  id: newId("pl"),
  source: "manual",
  nameEn: "",
  nameRu: "",
  group: "A",
  commodityType: "",
  tnved: "",
  kpved: null,
  capacity: { kind: "added", value: 0, unit: "pieces" },
  icvPct: 0,
  localization: null,
  certificate: null,
  note: null,
  registry: null,
});

export function ProductsForm({ profile, initial, onSave }: FormProps<"products">) {
  const t = useDictionary(texts);
  const [lines, setLines] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const types = useReference("commodity_types").map((i) => ({ value: i.label, label: i.label }));
  const tnved = useReference("tnved", true);
  const kpved = useReference("kpved", true);
  const groups = COMMODITY_GROUPS.map((g) => ({ value: g, label: t("groupN", { group: g }) }));
  const units = CAPACITY_UNITS.map((u) => ({ value: u, label: t(`unit.${u}`) }));
  const patch = (id: string, change: Partial<ProductLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...change } : l)));

  const save = () => {
    const e: string[] = [];
    const registry = lines.filter((l) => l.registry);
    lines.forEach((l, i) => {
      if (l.registry) return;
      // Вторая строка того же продукта из e-Ondiris не добавляется (MAN-25).
      if (registry.some((r) => r.tnved === l.tnved && (r.nameRu === l.nameRu.trim() || r.nameEn === l.nameEn.trim())))
        e.push(t("errDuplicateProduct", { n: String(i + 1) }));
    });
    setErrors(e);
    if (e.length === 0) onSave(lines);
  };

  return (
    <div className="flex flex-col gap-4">
      {lines.length === 0 && <p className="text-sm text-muted-foreground">{t("noProducts")}</p>}
      {lines.map((l, i) =>
        l.registry ? (
          <RegistryLine key={l.id} line={l} n={i + 1} bin={profile.bin} />
        ) : (
          <RowCard
            key={l.id}
            title={t("productN", { n: String(i + 1) })}
            onRemove={() => setLines((prev) => prev.filter((x) => x.id !== l.id))}
          >
            <FieldGrid>
              <TextField
                label={t("field.nameEn")}
                required
                value={l.nameEn}
                onChange={(x) => patch(l.id, { nameEn: x })}
              />
              <TextField
                label={t("field.nameRu")}
                required
                value={l.nameRu}
                onChange={(x) => patch(l.id, { nameRu: x })}
              />
              <ChoiceField
                label={t("field.group")}
                required
                items={groups}
                value={l.group}
                onChange={(x) => x && patch(l.id, { group: x as CommodityGroup })}
              />
              <ChoiceField
                label={t("field.commodityType")}
                required
                items={withCurrent(types, l.commodityType || null)}
                value={l.commodityType || null}
                placeholder={t("choose")}
                onChange={(x) => patch(l.id, { commodityType: x ?? "" })}
              />
              <ChoiceField
                label={t("field.tnved")}
                required
                items={withCurrent(tnved, l.tnved || null)}
                value={l.tnved || null}
                placeholder={t("choose")}
                onChange={(x) => patch(l.id, { tnved: x ?? "" })}
              />
              <ChoiceField
                label={t("field.kpved")}
                items={withCurrent(kpved, l.kpved)}
                value={l.kpved}
                placeholder={t("notSet")}
                onChange={(x) => patch(l.id, { kpved: x })}
              />
              <NumberField
                label={t("field.capacity")}
                required
                value={l.capacity.kind === "added" ? l.capacity.value : null}
                onChange={(x) =>
                  patch(l.id, {
                    capacity: {
                      kind: "added",
                      value: x ?? 0,
                      unit: l.capacity.kind === "added" ? l.capacity.unit : "pieces",
                    },
                  })
                }
              />
              <ChoiceField
                label={t("field.unit")}
                required
                items={units}
                value={l.capacity.kind === "added" ? l.capacity.unit : "pieces"}
                onChange={(x) =>
                  x &&
                  patch(l.id, {
                    capacity: {
                      kind: "added",
                      value: l.capacity.kind === "added" ? l.capacity.value : 0,
                      unit: x as CapacityUnit,
                    },
                  })
                }
              />
              <TextField label={t("field.icv")} value="0" readOnly description={t("icvHint")} />
              <NumberField
                label={t("field.localizationDone")}
                value={l.localization?.done ?? null}
                onChange={(x) =>
                  patch(l.id, { localization: x === null ? null : { done: x, total: l.localization?.total ?? x } })
                }
              />
              <NumberField
                label={t("field.localizationTotal")}
                value={l.localization?.total ?? null}
                onChange={(x) =>
                  patch(l.id, { localization: x === null ? null : { done: l.localization?.done ?? 0, total: x } })
                }
              />
            </FieldGrid>
            <TextField
              label={t("field.note")}
              multiline
              value={l.note ?? ""}
              onChange={(x) => patch(l.id, { note: x || null })}
            />
            <FileSlot
              label={t("field.productCertificate")}
              file={l.certificate}
              profileId={profile.id}
              slot={`product:${l.id}`}
              onSelect={(f) => patch(l.id, { certificate: f })}
            />
          </RowCard>
        ),
      )}
      <AddButton label={t("addProduct")} onClick={() => setLines((prev) => [...prev, emptyLine()])} />
      <SaveBar onSave={save} errors={errors} />
    </div>
  );
}

/** Строка из e-Ondiris: как её вернул реестр, без правки и удаления (MAN-25). */
function RegistryLine({ line, n, bin }: { line: ProductLine; n: number; bin: string }) {
  const t = useDictionary(texts);
  const format = useFormat();
  const r = line.registry!;
  const rows: [string, string][] = [
    [t("reg.entry"), r.entryNumber],
    [t("field.bin"), bin],
    [t("reg.product"), line.nameRu],
    [t("field.capacity"), line.capacity.kind === "registry" ? line.capacity.text : format.number(line.capacity.value)],
    [t("field.kpved"), line.kpved ?? "—"],
    [t("field.tnved"), line.tnved],
    [t("reg.enstru"), r.enstru],
    [t("field.icv"), line.icvPct === null ? "—" : t("percentValue", { value: format.number(line.icvPct) })],
    [
      t("reg.localization"),
      line.localization
        ? t("localizationValue", {
            done: format.number(line.localization.done),
            total: format.number(line.localization.total),
          })
        : "—",
    ],
    [t("reg.inclusion"), format.date(r.inclusionDate)],
  ];
  return (
    <RowCard
      title={
        <span className="flex flex-wrap items-center gap-2">
          {t("productN", { n: String(n) })}
          <Badge variant="secondary">{t("fromRegistry")}</Badge>
          <Badge variant={r.active ? "outline" : "destructive"}>{r.active ? t("reg.active") : t("reg.inactive")}</Badge>
        </span>
      }
    >
      <p className="text-sm text-muted-foreground">{t("registryHint")}</p>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {line.certificate && <FileRow label={t("field.productCertificate")} file={line.certificate} />}
    </RowCard>
  );
}

/** Производство — необязательная секция, не влияет на полноту (MAN-26). */
export function ProductionForm({ profile, initial, onSave }: FormProps<"production">) {
  const t = useDictionary(texts);
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const processes = useReference("processes");
  const equipmentTypes = useReference("equipment_types").map((i) => ({ value: i.label, label: i.label }));
  const products = (profile.pending.products ?? profile.sections.products).map((p) => ({ id: p.id, name: p.nameRu }));
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const patchRow = (id: string, change: Partial<Equipment>) =>
    set(
      "equipment",
      v.equipment.map((e) => (e.id === id ? { ...e, ...change } : e)),
    );
  const processLabel = (code: string) => processes.find((p) => p.value === code || p.label === code);

  const save = () => {
    const e: string[] = [];
    if (v.utilisationPct !== null && (v.utilisationPct < 0 || v.utilisationPct > 100)) e.push(t("errUtilisation"));
    setErrors(e);
    if (e.length === 0) onSave(v);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("productionHint")}</p>
      <FieldGrid>
        <NumberField label={t("field.areaM2")} value={v.areaM2} onChange={(x) => set("areaM2", x)} />
        <NumberField label={t("field.workshops")} value={v.workshops} onChange={(x) => set("workshops", x)} />
        <NumberField
          label={t("field.utilisationPct")}
          max={100}
          value={v.utilisationPct}
          onChange={(x) => set("utilisationPct", x)}
        />
      </FieldGrid>
      <RowCard title={t("field.processes")}>
        {processes.map((p) => {
          // В данных процессы записаны подписью справочника.
          const checked = v.processes.some((x) => processLabel(x)?.value === p.value);
          return (
            <CheckField
              key={p.value}
              label={p.label}
              checked={checked}
              onChange={(c) =>
                set(
                  "processes",
                  c ? [...v.processes, p.label] : v.processes.filter((x) => processLabel(x)?.value !== p.value),
                )
              }
            />
          );
        })}
      </RowCard>
      {v.equipment.map((e, i) => (
        <RowCard
          key={e.id}
          title={t("equipmentN", { n: String(i + 1) })}
          onRemove={() =>
            set(
              "equipment",
              v.equipment.filter((x) => x.id !== e.id),
            )
          }
        >
          <FieldGrid>
            <TextField label={t("field.equipmentName")} value={e.name} onChange={(x) => patchRow(e.id, { name: x })} />
            <ChoiceField
              label={t("field.equipmentType")}
              items={withCurrent(equipmentTypes, e.type || null)}
              value={e.type || null}
              placeholder={t("choose")}
              onChange={(x) => patchRow(e.id, { type: x ?? "" })}
            />
            <NumberField
              label={t("field.quantity")}
              value={e.quantity}
              onChange={(x) => patchRow(e.id, { quantity: x ?? 0 })}
            />
          </FieldGrid>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("linkedProducts")}</span>
            {products.map((p) => (
              <CheckField
                key={p.id}
                label={p.name}
                checked={e.productIds.includes(p.id)}
                onChange={(c) =>
                  patchRow(e.id, { productIds: c ? [...e.productIds, p.id] : e.productIds.filter((x) => x !== p.id) })
                }
              />
            ))}
          </div>
        </RowCard>
      ))}
      <AddButton
        label={t("addEquipment")}
        onClick={() =>
          set("equipment", [...v.equipment, { id: newId("eq"), name: "", type: "", quantity: 1, productIds: [] }])
        }
      />
      <RowCard title={t("field.photos")}>
        {v.photos.length === 0 && <p className="text-sm text-muted-foreground">{t("noPhotos")}</p>}
        {v.photos.map((f, i) => (
          <FileRow key={`${f.name}-${f.uploadedAt}`} label={t("photoN", { n: String(i + 1) })} file={f} />
        ))}
        <FileSlot
          label={t("addPhoto")}
          file={null}
          profileId={profile.id}
          slot={null}
          onSelect={(f) => set("photos", [...v.photos, f])}
        />
      </RowCard>
      <SaveBar onSave={save} errors={errors} />
    </div>
  );
}
