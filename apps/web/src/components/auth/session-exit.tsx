"use client";

import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useLogout } from "@/lib/session";

export function SessionExit({ changeAccount = false }: { changeAccount?: boolean }) {
  const t = useTranslations("auth");
  const logout = useLogout();
  return (
    <div className="space-y-3">
      {logout.isError && (
        <Alert variant="destructive">
          <AlertDescription>{t("logoutError")}</AlertDescription>
        </Alert>
      )}
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        {logout.isPending && <Spinner />}
        {t(changeAccount ? "changeAccount" : "signOut")}
      </Button>
    </div>
  );
}
