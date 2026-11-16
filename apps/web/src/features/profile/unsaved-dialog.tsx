import { useTranslations } from "use-intl";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function UnsavedDialog({ open, stay, leave }: { open: boolean; stay: () => void; leave: () => void }) {
  const t = useTranslations("profileEditor");
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) stay();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("unsavedTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("unsavedDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={stay}>
            {t("stay")}
          </Button>
          <Button variant="destructive" onClick={leave}>
            {t("discard")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
