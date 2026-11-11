import type { Locale } from "@imbc/contracts";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Messages } from "@/i18n/messages";
import { I18nProvider } from "@/i18n/provider";
import { createQueryClient } from "@/lib/query-client";

export function Providers({
  initialLocale,
  initialMessages,
  queryClient,
  children,
}: {
  initialLocale: Locale;
  initialMessages: Messages;
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale={initialLocale} initialMessages={initialMessages}>
        {/* Base UI не встраивает провайдер подсказок в Tooltip и Sidebar: он один на приложение. */}
        <TooltipProvider>{children}</TooltipProvider>
        <AppToaster />
      </I18nProvider>
      <ReactQueryDevtools buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}

/** Уведомления: область названа на языке интерфейса (у sonner по умолчанию — «Notifications»). */
function AppToaster() {
  const t = useTranslations("common");
  return <Toaster richColors position="top-right" containerAriaLabel={t("notifications")} />;
}
