import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { recordsKey, readReferences, selectedReferences, type Reference, type ReferenceCode } from "./api";
import { RecordsFailure } from "./feedback";
import { recordsAuthorityLost } from "./scope";
import { RecordsPaging } from "./paging";
import { referenceName } from "./names";
type Shared = {
  profileId: string;
  actorId: string;
  code: ReferenceCode;
  ids: string[];
  lost: (error: unknown) => void;
};
function useSelected({ profileId, actorId, code, ids, lost }: Shared) {
  const signature = [...ids].sort().join(",");
  return useQuery({
    queryKey: [...recordsKey(profileId, actorId), "selected-references", code, signature],
    queryFn: async ({ signal }) => {
      try {
        return await selectedReferences(profileId, code, signature ? signature.split(",") : [], signal);
      } catch (error) {
        if (recordsAuthorityLost(error)) lost(error);
        throw error;
      }
    },
    staleTime: 0,
    gcTime: 0,
  });
}
export function ReferenceLabels(props: Shared) {
  const t = useTranslations("imbcRecords"),
    locale = useLocale(),
    selected = useSelected(props);
  if (!props.ids.length) return <span>{t("unknown")}</span>;
  if (selected.isPending) return <span role="status">{t("loading")}</span>;
  if (selected.isError) return <RecordsFailure error={selected.error} retry={() => void selected.refetch()} />;
  return (
    <ul className="space-y-1">
      {props.ids.map((id) => {
        const row = selected.data.find((item) => item.id === id);
        return (
          <li key={id} className="wrap-anywhere">
            {row ? referenceName(row, locale) : t("unavailableReference")}
            {row?.retiredAt && <span className="ml-2 text-xs text-muted-foreground">{t("retired")}</span>}
          </li>
        );
      })}
    </ul>
  );
}
export function ReferencePicker(
  props: Shared & {
    baselineIds: string[];
    multiple?: boolean;
    disabled: boolean;
    change: (ids: string[]) => void;
    blocking: (value: boolean) => void;
  },
) {
  const t = useTranslations("imbcRecords"),
    locale = useLocale(),
    [offset, setOffset] = useState(0),
    selected = useSelected(props);
  const page = useQuery({
    queryKey: [...recordsKey(props.profileId, props.actorId), "reference-options", props.code, offset],
    queryFn: async ({ signal }) => {
      try {
        return await readReferences(props.profileId, props.code, offset, signal);
      } catch (error) {
        if (recordsAuthorityLost(error)) props.lost(error);
        throw error;
      }
    },
    staleTime: 0,
    gcTime: 0,
  });
  const { blocking } = props;
  const retiredNewChoice = !!selected.data?.some((row) => row.retiredAt && !props.baselineIds.includes(row.id));
  const blocks = props.ids.length > 0 && (selected.isPending || selected.isError || retiredNewChoice);
  useEffect(() => {
    blocking(blocks);
    return () => blocking(false);
  }, [blocks, blocking]);
  function toggle(row: Reference) {
    if (props.disabled || (row.retiredAt && !props.ids.includes(row.id))) return;
    props.change(
      props.multiple
        ? props.ids.includes(row.id)
          ? props.ids.filter((id) => id !== row.id)
          : [...props.ids, row.id]
        : props.ids.includes(row.id)
          ? []
          : [row.id],
    );
  }
  const selectedRows = selected.data ?? [],
    rows = [...selectedRows, ...(page.data?.items ?? []).filter((row) => !props.ids.includes(row.id))];
  return (
    <div className="min-w-0 space-y-3 rounded-lg border p-3">
      <ReferenceLabels {...props} />
      {retiredNewChoice && (
        <p role="alert" className="text-sm text-destructive">
          {t("errors.reference")}
        </p>
      )}
      {page.isPending && <p role="status">{t("loading")}</p>}
      {page.isError && <RecordsFailure error={page.error} retry={() => void page.refetch()} />}
      {page.data && (
        <>
          {!page.data.total && <p className="text-sm text-muted-foreground">{t("noApprovedChoices")}</p>}
          <div className="space-y-2">
            {rows.map((row) => (
              <label key={row.id} className="flex min-w-0 items-start gap-2 text-sm">
                <Checkbox
                  checked={props.ids.includes(row.id)}
                  disabled={props.disabled || (!!row.retiredAt && !props.ids.includes(row.id))}
                  onCheckedChange={() => toggle(row)}
                />
                <span className="min-w-0 wrap-anywhere">
                  {referenceName(row, locale)}
                  {row.retiredAt && <span className="ml-2 text-muted-foreground">{t("retired")}</span>}
                </span>
              </label>
            ))}
          </div>
          {!props.multiple && props.ids.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={props.disabled}
              onClick={() => props.change([])}
            >
              {t("clearSelection")}
            </Button>
          )}
          <RecordsPaging
            offset={offset}
            total={page.data.total}
            disabled={props.disabled || page.isFetching}
            change={setOffset}
          />
        </>
      )}
    </div>
  );
}
