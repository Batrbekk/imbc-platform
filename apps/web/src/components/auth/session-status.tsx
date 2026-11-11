import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Пока проверяется сеанс — индикатор; при сбое связи — сообщение и повтор. */
export function SessionStatus({ error = false, retry }: { error?: boolean; retry?: () => void }) {
  const t = useTranslations("auth");
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-4 p-6 text-center" role="status">
      {error ? (
        <>
          <p className="max-w-sm text-sm text-muted-foreground">{t("connectionError")}</p>
          {retry && <Button onClick={retry}>{t("retry")}</Button>}
        </>
      ) : (
        <>
          <Spinner className="size-6 text-primary" />
          <p className="text-sm text-muted-foreground">{t("checkingSession")}</p>
        </>
      )}
    </div>
  );
}
