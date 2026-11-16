import type { ImbcProductContextRead } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { readProducts, readContextProducts, readContext, recordsKey, type RecordScope } from "./api";
import { productName } from "./names";
import { RecordsFailure } from "./feedback";
import { RecordsPaging } from "./paging";
import { RecordSnapshot } from "./snapshot";
type Shared = {
  scope: RecordScope;
  actorId: string;
  expert: boolean;
  canEdit: boolean;
  busy: boolean;
  lost: (error: unknown) => void;
  edit: (row: ImbcProductContextRead | null, id: string, name: string, button: HTMLButtonElement) => void;
  history: (id: string, button: HTMLButtonElement) => void;
};
export function ProductsView(
  props: Shared & {
    offset: number;
    contextOffset: number;
    selectedId?: string;
    change: (patch: Record<string, string>) => void;
  },
) {
  const { scope, actorId, lost, offset, contextOffset, selectedId, change, busy } = props,
    t = useTranslations("imbcRecords"),
    locale = useLocale();
  const options = useQuery({
    queryKey: [...recordsKey(scope.profileId, actorId), "products", offset],
    queryFn: async ({ signal }) => {
      try {
        return await readProducts(scope, offset, 25, signal);
      } catch (error) {
        lost(error);
        throw error;
      }
    },
    staleTime: 0,
    gcTime: 0,
  });
  const contexts = useQuery({
    queryKey: [...recordsKey(scope.profileId, actorId), "context-products", contextOffset],
    queryFn: async ({ signal }) => {
      try {
        return await readContextProducts(scope, { offset: contextOffset }, signal);
      } catch (error) {
        lost(error);
        throw error;
      }
    },
    staleTime: 0,
    gcTime: 0,
  });
  const current = options.data?.items.find((row) => row.productLineIdentityId === selectedId),
    listed = contexts.data?.items.find((row) => row.product.productLineIdentityId === selectedId);
  const exact = useQuery({
    queryKey: [...recordsKey(scope.profileId, actorId), "context-product", selectedId],
    enabled: !!selectedId && !current && !listed && options.isSuccess && contexts.isSuccess,
    queryFn: async ({ signal }) => {
      try {
        return await readContextProducts(scope, { ids: [selectedId!] }, signal);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) lost(error);
        throw error;
      }
    },
    staleTime: 0,
    gcTime: 0,
  });
  const retained = listed ?? exact.data?.items[0],
    selected = current ?? retained?.product,
    selectedIsCurrent = current !== undefined || retained?.product.isCurrent === true;
  return (
    <div className="min-w-0 space-y-6">
      <section className="min-w-0 space-y-3">
        <h3 className="font-medium">{t("currentProducts")}</h3>
        <p className="text-sm text-muted-foreground">{t("productHint")}</p>
        {options.isPending ? (
          <p role="status">{t("loading")}</p>
        ) : options.isError ? (
          <RecordsFailure error={options.error} retry={() => void options.refetch()} />
        ) : options.data ? (
          <>
            {!options.data.items.length ? (
              <p>{t("noProducts")}</p>
            ) : (
              <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
                {options.data.items.map((row) => (
                  <li key={row.productLineIdentityId} className="min-w-0">
                    <Button
                      variant={selectedId === row.productLineIdentityId ? "secondary" : "outline"}
                      className="h-auto w-full min-w-0 justify-start whitespace-normal py-3 text-left wrap-anywhere"
                      disabled={busy || options.isFetching}
                      aria-pressed={selectedId === row.productLineIdentityId}
                      onClick={() => change({ product: row.productLineIdentityId })}
                    >
                      {productName(row, locale, t("unnamedProduct"))}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <RecordsPaging
              label="currentProductPagination"
              offset={offset}
              total={options.data.total}
              disabled={busy || options.isFetching}
              change={(next) => change({ productOffset: String(next), product: "" })}
            />
          </>
        ) : null}
      </section>
      <section className="min-w-0 space-y-3">
        <h3 className="font-medium">{t("recordedContexts")}</h3>
        <p className="text-sm text-muted-foreground">{t("retainedContextsHint")}</p>
        {contexts.isPending ? (
          <p role="status">{t("loading")}</p>
        ) : contexts.isError ? (
          <RecordsFailure error={contexts.error} retry={() => void contexts.refetch()} />
        ) : contexts.data ? (
          <>
            {!contexts.data.items.length ? (
              <p>{t("noRecordedContexts")}</p>
            ) : (
              <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
                {contexts.data.items.map((item) => (
                  <li key={item.product.productLineIdentityId} className="min-w-0">
                    <Button
                      variant={selectedId === item.product.productLineIdentityId ? "secondary" : "outline"}
                      className="h-auto w-full min-w-0 flex-col items-start whitespace-normal py-3 text-left wrap-anywhere"
                      disabled={busy || contexts.isFetching}
                      aria-label={
                        t("recordedProduct", { name: productName(item.product, locale, t("unnamedProduct")) }) +
                        (item.product.isCurrent ? "" : " " + t("productRemoved"))
                      }
                      aria-pressed={selectedId === item.product.productLineIdentityId}
                      onClick={() => change({ product: item.product.productLineIdentityId })}
                    >
                      <span>
                        {t("recordedProduct", { name: productName(item.product, locale, t("unnamedProduct")) })}
                      </span>
                      {!item.product.isCurrent && <span className="text-xs font-normal">{t("productRemoved")}</span>}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <RecordsPaging
              label="contextPagination"
              offset={contextOffset}
              total={contexts.data.total}
              disabled={busy || contexts.isFetching}
              change={(next) => change({ contextOffset: String(next), product: "" })}
            />
          </>
        ) : null}
      </section>
      {selected ? (
        <ContextView
          key={selected.productLineIdentityId}
          {...props}
          canEdit={props.canEdit && !options.isFetching && !contexts.isFetching}
          id={selected.productLineIdentityId}
          name={productName(selected, locale, t("unnamedProduct"))}
          isCurrent={selectedIsCurrent}
        />
      ) : selectedId && exact.isError ? (
        <RecordsFailure error={exact.error} retry={() => void exact.refetch()} />
      ) : selectedId && exact.isFetching ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <p>{t("chooseProduct")}</p>
      )}
    </div>
  );
}
function ContextView({
  scope,
  actorId,
  expert,
  canEdit,
  busy,
  lost,
  id,
  name,
  isCurrent,
  edit,
  history,
}: Shared & { id: string; name: string; isCurrent: boolean }) {
  const t = useTranslations("imbcRecords"),
    record = useQuery({
      queryKey: [...recordsKey(scope.profileId, actorId), "context", id],
      queryFn: async ({ signal }) => {
        try {
          return await readContext(scope, id, signal);
        } catch (error) {
          lost(error);
          throw error;
        }
      },
      staleTime: 0,
      gcTime: 0,
    });
  return (
    <section className="min-w-0 space-y-4 rounded-lg border p-4">
      <h3 className="whitespace-pre-wrap wrap-anywhere font-medium">{name}</h3>
      {!isCurrent && <p className="text-sm text-muted-foreground">{t("productRemoved")}</p>}
      {record.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : record.isError ? (
        <RecordsFailure error={record.error} retry={() => void record.refetch()} />
      ) : (
        <>
          {record.data ? (
            <RecordSnapshot row={record.data} {...scope} actorId={actorId} lost={lost} />
          ) : (
            <p>{t("noProductContext")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {expert && (isCurrent || record.data) && (
              <Button
                disabled={!canEdit || busy || record.isFetching}
                onClick={(event) => edit(record.data ?? null, id, name, event.currentTarget)}
              >
                {t("editProductContext")}
              </Button>
            )}
            {record.data && (
              <Button
                variant="outline"
                disabled={busy || record.isFetching}
                onClick={(event) => history(id, event.currentTarget)}
              >
                {t("history")}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
