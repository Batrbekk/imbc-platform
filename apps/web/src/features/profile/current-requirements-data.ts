import { certificateEditorChoicesSchema, documentEditorChoicesSchema } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type RequirementsKind = "certificates" | "documents";
export function useCurrentRequirements(kind: RequirementsKind, enabled: boolean) {
  return useQuery({
    queryKey: ["profile", "editor-requirements", kind],
    enabled,
    queryFn: async () => {
      const body = await api<unknown>(`/v1/profiles/own/sections/${kind}/choices`);
      return kind === "certificates"
        ? certificateEditorChoicesSchema.parse(body)
        : documentEditorChoicesSchema.parse(body);
    },
  });
}
