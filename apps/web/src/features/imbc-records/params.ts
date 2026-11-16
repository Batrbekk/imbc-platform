import { z } from "zod";
import { surveyReturn } from "@/features/site-survey/params";
const schema = z.strictObject({
  view: z.enum(["notes", "engagement", "products"]).default("notes"),
  noteOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  productOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  contextOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  product: z.uuid().optional(),
});
export function recordsParams(search: URLSearchParams) {
  const keys = ["view", "noteOffset", "productOffset", "contextOffset", "product"],
    raw = Object.fromEntries(keys.flatMap((k) => (search.has(k) ? [[k, search.get(k)]] : []))),
    parsed = schema.safeParse(raw);
  return {
    valid:
      parsed.success &&
      keys.every((k) => search.getAll(k).length <= 1) &&
      [...search.keys()].every((k) => keys.includes(k)),
    value: parsed.success ? parsed.data : schema.parse({}),
  };
}
export const recordsReturn = surveyReturn;
