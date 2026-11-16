import type { z } from "zod";
import { ProblemException } from "../../common/problem.js";

/** Module's documented input code; server/output validation remains parseResponse and fails as 500. */
export function parseSurveyInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new ProblemException(
      400,
      "validation_failed",
      "Некорректные данные обследования.",
      undefined,
      {
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  return parsed.data;
}
