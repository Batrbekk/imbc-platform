import type { Locale } from "@imbc/contracts";
import { RouterProvider } from "react-router";

import { Providers } from "@/components/app/providers";
import type { Messages } from "@/i18n/messages";
import { createAppRouter } from "@/router";

// Один роутер на вкладку: StrictMode повторно вызывает инициализаторы состояния,
// а лишний браузерный роутер остался бы подписан на историю.
const router = createAppRouter();

export function App({ initialLocale, initialMessages }: { initialLocale: Locale; initialMessages: Messages }) {
  return (
    <Providers initialLocale={initialLocale} initialMessages={initialMessages}>
      <RouterProvider router={router} />
    </Providers>
  );
}
