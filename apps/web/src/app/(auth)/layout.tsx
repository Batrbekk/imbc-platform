import { getTranslations } from "next-intl/server";
import { BrandMark } from "@/components/app/brand";
import { LocaleSwitcher } from "@/components/app/locale-switcher";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("common");
  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2 font-semibold">
          <BrandMark className="size-7" />
          {t("appName")}
        </div>
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
