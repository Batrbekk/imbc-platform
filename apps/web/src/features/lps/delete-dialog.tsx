import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { lpsApi } from "./api";
import { LpsDialog, LpsError } from "./feedback";
export function LpsDeleteDialog({ kind, id, name, onClose, onDeleted, onPendingChange }: { kind: "company" | "entry"; id: string; name: string; onClose: () => void; onDeleted: () => void; onPendingChange: (value: boolean) => void }) {
  const t = useTranslations("lps"), client = useQueryClient();
  const remove = useMutation({ mutationFn: () => kind === "company" ? lpsApi.deleteCompany(id) : lpsApi.deleteEntry(id), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["lps"] }); onDeleted(); } });
  useEffect(() => { onPendingChange(remove.isPending); }, [remove.isPending, onPendingChange]);
  return <LpsDialog title={t(kind === "company" ? "deleteCompany" : "deleteEntry")} description={t(kind === "company" ? "deleteCompanyDescription" : "deleteEntryDescription")} dirty={false} pending={remove.isPending} onClose={onClose}>
    <p className="font-medium wrap-anywhere">{name}</p>{remove.isError && <LpsError error={remove.error} />}<Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>{t(remove.isPending ? "deleting" : "delete")}</Button>
  </LpsDialog>;
}
