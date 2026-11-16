import { ApiError } from "@/lib/api";
export const recordsAuthorityLost = (error: unknown) =>
  error instanceof ApiError && [401, 403, 404].includes(error.status);
