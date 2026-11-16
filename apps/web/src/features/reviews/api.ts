import {
  reviewOperationalQueueSchema, reviewAssignmentQueueSchema, reviewAssignmentMetadataSchema,
  reviewExpertOptionsSchema, reviewWorkbenchSchema, reviewSectionReadSchema,
  reviewSectionDecisionResultSchema, reviewSubmitResultSchema,
  type ReviewAssignInput, type ReviewSectionDecisionInput, type SectionKind,
} from "@imbc/contracts";
import { api } from "@/lib/api";

export const reviewKeys = {
  queues: ["review-workflow", "queue"] as const,
  queue: (admin: boolean, query: string) => ["review-workflow", "queue", admin ? "assignment" : "operational", query] as const,
  workbench: (id: string) => ["review-workflow", "assignment", id] as const,
  section: (id: string, kind: SectionKind) => ["review-workflow", "assignment", id, kind] as const,
};
const route = (id: string) => `/v1/reviews/assignments/${encodeURIComponent(id)}`;
export const reviewsApi = {
  queue: async (query: string, signal?: AbortSignal) => reviewOperationalQueueSchema.parse(await api(`/v1/reviews/queue${query ? `?${query}` : ""}`, { signal })),
  assignments: async (query: string, signal?: AbortSignal) => reviewAssignmentQueueSchema.parse(await api(`/v1/reviews/assignment-queue${query ? `?${query}` : ""}`, { signal })),
  assignment: async (id: string) => reviewAssignmentMetadataSchema.parse(await api(`/v1/reviews/assignment-queue/${encodeURIComponent(id)}`)),
  experts: async (admin: boolean, signal?: AbortSignal) => reviewExpertOptionsSchema.parse(await api(admin ? "/v1/reviews/experts" : "/v1/reviews/queue/experts", { signal })),
  take: async (id: string) => reviewAssignmentMetadataSchema.parse(await api(`${route(id)}/take`, { method: "POST", json: {} })),
  assign: async (id: string, value: ReviewAssignInput) => reviewAssignmentMetadataSchema.parse(await api(`${route(id)}/assign`, { method: "POST", json: value })),
  read: async (id: string, signal?: AbortSignal) => reviewWorkbenchSchema.parse(await api(route(id), { signal })),
  open: async (id: string) => reviewWorkbenchSchema.parse(await api(`${route(id)}/open`, { method: "POST", json: {} })),
  section: async (id: string, kind: SectionKind, signal?: AbortSignal) => reviewSectionReadSchema.parse(await api(`${route(id)}/sections/${kind}`, { signal })),
  decide: async (id: string, value: ReviewSectionDecisionInput) => reviewSectionDecisionResultSchema.parse(await api(`${route(id)}/section-decision`, { method: "POST", json: value })),
  submit: async (id: string) => reviewSubmitResultSchema.parse(await api(`${route(id)}/submit-result`, { method: "POST", json: {} })),
};
