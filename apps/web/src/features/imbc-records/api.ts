import { z } from "zod";
import {
  imbcNoteListSchema,
  imbcNoteReadSchema,
  imbcNoteCreateSchema,
  imbcNoteUpdateSchema,
  imbcEngagementReadSchema,
  imbcEngagementPutSchema,
  imbcProductContextReadSchema,
  imbcProductContextPutSchema,
  imbcRecordHistorySchema,
  imbcRecordListQuerySchema,
  imbcRecordHistoryQuerySchema,
  imbcRecordIdempotencyKeySchema,
  imbcRecordProductOptionsSchema,
  imbcRecordContextProductsSchema,
  imbcRecordContextProductsQuerySchema,
  ROLES,
  ORGANIZATION_TYPES,
  imbcRecordReferenceOptionsSchema,
  imbcRecordReferenceOptionsQuerySchema,
  type ImbcNoteCreate,
  type ImbcNoteUpdate,
  type ImbcEngagementPut,
  type ImbcProductContextPut,
  type ImbcRecordRead,
  type ImbcRecordKind,
} from "@imbc/contracts";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/session";

const actorEvidence = z.object({
  user: z.object({
    id: z.uuid(),
    role: z.enum(ROLES),
    organizationId: z.uuid(),
    organizationType: z.enum(ORGANIZATION_TYPES),
    email: z.string(),
    fullName: z.string().nullable(),
  }),
  gates: z.object({ mfa: z.boolean(), responsibility: z.boolean() }),
});
export async function readRecordActor() {
  // A temporary probe failure must not turn the shared session query into an error and unmount a dirty editor.
  const evidence = await api<Me>("/auth/me");
  if (!actorEvidence.safeParse(evidence).success) throw new ApiError(503, "internal", "");
  return evidence;
}

export type NoteList = z.infer<typeof imbcNoteListSchema>;
export type ProductOptions = z.infer<typeof imbcRecordProductOptionsSchema>;
export type ContextProducts = z.infer<typeof imbcRecordContextProductsSchema>;
export type ReferenceOptions = z.infer<typeof imbcRecordReferenceOptionsSchema>;
export type Reference = ReferenceOptions["items"][number];
export type ReferenceCode = ReferenceOptions["dictionaryCode"];
export type RecordHistory = z.infer<typeof imbcRecordHistorySchema>;
export type RecordScope = { profileId: string; organizationId: string };
export type HistoryTarget = { kind: ImbcRecordKind; id?: string };
export const recordsKey = (profileId: string, actorId: string) => ["imbc-records", profileId, actorId] as const;
const path = (profileId: string) => `/v1/profiles/${z.uuid().parse(profileId)}`;
function scoped<T extends { profileId: string; organizationId: string }>(value: T, scope: RecordScope): T {
  if (value.profileId !== scope.profileId || value.organizationId !== scope.organizationId)
    throw new ApiError(404, "not_found", "");
  return value;
}
export function recordPath(profileId: string, target: HistoryTarget) {
  if (target.kind === "note") return `${path(profileId)}/imbc-notes/${z.uuid().parse(target.id)}`;
  if (target.kind === "engagement") return `${path(profileId)}/imbc-engagement`;
  return `${path(profileId)}/products/${z.uuid().parse(target.id)}/imbc-context`;
}
const query = (offset = 0, limit = 25) =>
  new URLSearchParams(
    Object.entries(imbcRecordListQuerySchema.parse({ offset, limit })).map(([k, v]) => [k, String(v)]),
  ).toString();
const write = (method: string, json: unknown, key: string) => ({
  method,
  json,
  headers: { "Idempotency-Key": imbcRecordIdempotencyKeySchema.parse(key) },
});
export async function readNotes(profileId: string, offset: number, limit: number, signal?: AbortSignal) {
  const value = imbcNoteListSchema.parse(
    await api(`${path(profileId)}/imbc-notes?${query(offset, limit)}`, { signal }),
  );
  if (value.profileId !== profileId) throw new ApiError(404, "not_found", "");
  value.items.forEach((row) => scoped(row, value));
  return value;
}
export async function readNote(scope: RecordScope, id: string) {
  const value = scoped(imbcNoteReadSchema.parse(await api(recordPath(scope.profileId, { kind: "note", id }))), scope);
  if (value.id !== id) throw new ApiError(404, "not_found", "");
  return value;
}
export async function saveNote(
  scope: RecordScope,
  id: string | null,
  body: ImbcNoteCreate | ImbcNoteUpdate,
  key: string,
) {
  const parsed = id ? imbcNoteUpdateSchema.parse(body) : imbcNoteCreateSchema.parse(body);
  const value = scoped(
    imbcNoteReadSchema.parse(
      await api(
        id ? recordPath(scope.profileId, { kind: "note", id }) : `${path(scope.profileId)}/imbc-notes`,
        write(id ? "PUT" : "POST", parsed, key),
      ),
    ),
    scope,
  );
  if (id && value.id !== id) throw new ApiError(404, "not_found", "");
  return value;
}
export async function readEngagement(scope: RecordScope, signal?: AbortSignal) {
  const value = imbcEngagementReadSchema
    .nullable()
    .parse(await api(recordPath(scope.profileId, { kind: "engagement" }), { signal }));
  return value && scoped(value, scope);
}
export async function saveEngagement(scope: RecordScope, body: ImbcEngagementPut, key: string) {
  return scoped(
    imbcEngagementReadSchema.parse(
      await api(
        recordPath(scope.profileId, { kind: "engagement" }),
        write("PUT", imbcEngagementPutSchema.parse(body), key),
      ),
    ),
    scope,
  );
}
export async function readContext(scope: RecordScope, id: string, signal?: AbortSignal) {
  const value = imbcProductContextReadSchema
    .nullable()
    .parse(await api(recordPath(scope.profileId, { kind: "product_context", id }), { signal }));
  if (!value) return null;
  scoped(value, scope);
  if (value.productLineIdentityId !== id) throw new ApiError(404, "not_found", "");
  return value;
}
export async function saveContext(scope: RecordScope, id: string, body: ImbcProductContextPut, key: string) {
  const value = scoped(
    imbcProductContextReadSchema.parse(
      await api(
        recordPath(scope.profileId, { kind: "product_context", id }),
        write("PUT", imbcProductContextPutSchema.parse(body), key),
      ),
    ),
    scope,
  );
  if (value.productLineIdentityId !== id) throw new ApiError(404, "not_found", "");
  return value;
}
export async function readProducts(scope: RecordScope, offset: number, limit: number, signal?: AbortSignal) {
  return scoped(
    imbcRecordProductOptionsSchema.parse(
      await api(`${path(scope.profileId)}/imbc-records/product-options?${query(offset, limit)}`, { signal }),
    ),
    scope,
  );
}
export async function readContextProducts(
  scope: RecordScope,
  selection: { offset: number } | { ids: string[] },
  signal?: AbortSignal,
) {
  const raw =
    "ids" in selection
      ? { ids: [...new Set(selection.ids)].sort().join(",") }
      : { offset: selection.offset, limit: 25 };
  const checked = imbcRecordContextProductsQuerySchema.parse(raw);
  const search = new URLSearchParams(Object.entries(raw).map(([key, value]) => [key, String(value)]));
  const result = scoped(
    imbcRecordContextProductsSchema.parse(
      await api(`${path(scope.profileId)}/imbc-records/context-products?${search}`, { signal }),
    ),
    scope,
  );
  if (
    "ids" in checked &&
    (result.items.length !== checked.ids.length ||
      new Set(result.items.map((item) => item.product.productLineIdentityId)).size !== checked.ids.length ||
      result.items.some((item) => !checked.ids.includes(item.product.productLineIdentityId)))
  )
    throw new ApiError(404, "not_found", "");
  return result;
}
export async function readReferences(profileId: string, code: ReferenceCode, offset: number, signal?: AbortSignal) {
  const value = imbcRecordReferenceOptionsSchema.parse(
    await api(`${path(profileId)}/imbc-records/reference-options/${code}?${query(offset, 25)}`, { signal }),
  );
  if (value.dictionaryCode !== code) throw new ApiError(404, "not_found", "");
  return value;
}
export async function selectedReferences(profileId: string, code: ReferenceCode, ids: string[], signal?: AbortSignal) {
  if (!ids.length) return [];
  const unique = [...new Set(ids)].sort(),
    value = new URLSearchParams({ ids: unique.join(",") });
  imbcRecordReferenceOptionsQuerySchema.parse({ ids: value.get("ids") });
  const result = imbcRecordReferenceOptionsSchema.parse(
    await api(`${path(profileId)}/imbc-records/reference-options/${code}?${value}`, { signal }),
  );
  if (
    result.dictionaryCode !== code ||
    result.items.length !== unique.length ||
    new Set(result.items.map((row) => row.id)).size !== unique.length ||
    result.items.some((row) => !unique.includes(row.id))
  )
    throw new ApiError(404, "not_found", "");
  return result.items;
}
export function recordKind(row: ImbcRecordRead): ImbcRecordKind {
  return "id" in row ? "note" : "productLineIdentityId" in row ? "product_context" : "engagement";
}
export async function readHistory(scope: RecordScope, target: HistoryTarget, beforeId?: string, signal?: AbortSignal) {
  const params = imbcRecordHistoryQuerySchema.parse(beforeId ? { beforeId, limit: 25 } : { limit: 25 }),
    search = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const result = imbcRecordHistorySchema.parse(
    await api(`${recordPath(scope.profileId, target)}/history?${search}`, { signal }),
  );
  for (const entry of result.items)
    for (const row of [entry.before, entry.after])
      if (row) {
        scoped(row, scope);
        if (
          recordKind(row) !== target.kind ||
          (target.kind === "note" && (!("id" in row) || row.id !== target.id)) ||
          (target.kind === "product_context" &&
            (!("productLineIdentityId" in row) || row.productLineIdentityId !== target.id))
        )
          throw new ApiError(404, "not_found", "");
      }
  return result;
}
