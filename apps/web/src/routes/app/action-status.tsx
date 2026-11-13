import { CircleAlertIcon, CircleCheckIcon, XIcon } from "lucide-react";

import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import type { Status } from "./admin-actions";

/**
 * Строка итога последнего действия: видна и после прокрутки к нужной карточке (липкая), читается программой
 * чтения с экрана (aria-live polite) и остаётся до следующего действия или до «Скрыть». Alert — с ключом
 * объявления: тот же текст дважды подряд — новый элемент, его читают заново; он же коротко проявляется, и
 * видно, что действие выполнено ещё раз.
 */
export function ActionStatus({
  status,
  onDismiss,
  dismissLabel,
}: {
  status: Status | null;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  return (
    <div aria-live="polite" aria-atomic="true" className="sticky top-2 z-20 empty:-mt-4">
      {status && (
        <Alert
          key={status.id}
          role={undefined}
          variant={status.tone === "error" ? "destructive" : "default"}
          className="shadow-md animate-in fade-in-0 duration-200"
        >
          {status.tone === "error" ? <CircleAlertIcon aria-hidden="true" /> : <CircleCheckIcon aria-hidden="true" />}
          <AlertDescription className="wrap-anywhere">{status.text}</AlertDescription>
          <AlertAction>
            <Button variant="ghost" size="icon-xs" aria-label={dismissLabel} onClick={onDismiss}>
              <XIcon aria-hidden="true" />
            </Button>
          </AlertAction>
        </Alert>
      )}
    </div>
  );
}
