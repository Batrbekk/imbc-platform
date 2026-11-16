import { reviewQueueFilterSchema, reviewAssignmentQueueFilterSchema, type ReviewQueueFilter } from "@imbc/contracts";

export const REVIEW_FILTER_KEYS = ["q", "status", "assignee", "receivedFrom", "receivedTo", "offset", "limit"] as const;
export function reviewParams(search: URLSearchParams, admin: boolean) {
  if (REVIEW_FILTER_KEYS.some(key => search.getAll(key).length > 1)) return { value: { offset: 0, limit: 25 } as ReviewQueueFilter, valid: false };
  const input = Object.fromEntries(REVIEW_FILTER_KEYS.flatMap(key => {
    if (admin && (key === "receivedFrom" || key === "receivedTo")) return [];
    const values = search.getAll(key);
    return values.length === 1 && values[0] !== "" ? [[key, values[0]]] : [];
  }));
  const schema = admin ? reviewAssignmentQueueFilterSchema : reviewQueueFilterSchema;
  const result = schema.safeParse(input);
  if (result.success) return { value: result.data as ReviewQueueFilter, valid: true };
  return { value: { offset: 0, limit: 25 } as ReviewQueueFilter, valid: false };
}
export function reviewQuery(value: ReviewQueueFilter, admin: boolean) {
  const query = new URLSearchParams();
  if (value.q) query.set("q", value.q);
  if (value.status?.length) query.set("status", value.status.join(","));
  if (value.assignee?.length) query.set("assignee", value.assignee.join(","));
  if (!admin && value.receivedFrom) query.set("receivedFrom", value.receivedFrom);
  if (!admin && value.receivedTo) query.set("receivedTo", value.receivedTo);
  query.set("offset", String(value.offset)); query.set("limit", String(value.limit));
  return query.toString();
}
