import { siteSurveyListQuerySchema, siteSurveyRequestListQuerySchema } from "@imbc/contracts";
import { REVIEW_FILTER_KEYS, reviewParams } from "@/features/reviews/params";

/** A survey may be opened for a company that is not visible in the catalogue. */
export function surveyReturn(from: unknown, profileId: string, expert: boolean) {
  const fallback = expert ? { to: "/reviews", label: "backToQueue" as const } : { to: "/catalog", label: "backToCatalog" as const };
  if (typeof from !== "string" || from.includes("\\") || from.includes("#") || [...from].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return fallback;
  const question = from.indexOf("?"), pathname = question < 0 ? from : from.slice(0, question);
  const query = new URLSearchParams(question < 0 ? "" : from.slice(question + 1));
  if (pathname === `/companies/${profileId}` && query.size === 0) return { to: pathname, label: "backToCompany" as const };
  if (expert && pathname === "/reviews" && [...query.keys()].every(key => (REVIEW_FILTER_KEYS as readonly string[]).includes(key)) && reviewParams(query, false).valid)
    return { to: from, label: "backToQueue" as const };
  if (expert && pathname === "/imbc/site-survey-requests" && [...query.keys()].every(key => ["offset", "limit", "name", "profileId"].includes(key)) && surveyParams(query, true).valid)
    return { to: from, label: "backToRequests" as const };
  return fallback;
}

/** Retain only canonical URL fields and reject repeated known keys before sending the request. */
export function surveyParams(search: URLSearchParams, requests = false) {
  const keys = requests ? ["offset", "limit", "name", "profileId"] : ["offset", "limit"];
  const raw = Object.fromEntries(keys.flatMap(key => search.has(key) ? [[key, search.get(key)]] : []));
  const parsed = (requests ? siteSurveyRequestListQuerySchema : siteSurveyListQuerySchema).safeParse(raw);
  return { valid: parsed.success && keys.every(key => search.getAll(key).length <= 1),
    value: parsed.success ? parsed.data : siteSurveyListQuerySchema.parse({}) };
}
export function surveyQuery(params: { offset: number; limit: number; name?: string; profileId?: string }) {
  const result = new URLSearchParams({ offset: String(params.offset), limit: String(params.limit) });
  if (params.name) result.set("name", params.name); if (params.profileId) result.set("profileId", params.profileId);
  return result.toString();
}
