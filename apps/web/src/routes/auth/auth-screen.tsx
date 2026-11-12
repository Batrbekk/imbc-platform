import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * Каркас экрана входа внутри рамки (как форма блока shadcn `login-02`): заголовок `h1`, пояснение,
 * содержимое и нижняя строка — без карточки с тенью. `wide` — для длинной формы регистрации.
 */
export function AuthScreen({
  title,
  description,
  footer,
  wide = false,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex w-full flex-col gap-6", wide ? "max-w-md" : "max-w-sm")}>
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="break-words text-sm text-balance text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
      {footer && (
        <p className="flex flex-wrap justify-center gap-x-1 gap-y-1 text-center text-sm text-muted-foreground">
          {footer}
        </p>
      )}
    </div>
  );
}
