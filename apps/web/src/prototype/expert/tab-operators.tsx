// Операторы по профилю: кто работает с производителем, визиты, заметки и operator requests всех операторов —
// SME видит их, производитель и другие операторы нет (IMBC-16, IMBC-18, OPR-22, GEN-11, GEN-12).
import { cn } from "cn";
import { Link } from "react-router";

import { buttonVariants } from "@/components/ui/button";
import type { ProtoProfile } from "@/prototype/data";
import { useDictionary } from "@/prototype/i18n";

import { OperatorActivity } from "./dossier";
import { expertPath } from "./paths";
import { texts } from "./texts";

export function OperatorsTab({ profile }: { profile: ProtoProfile }) {
  const t = useDictionary(texts);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">{t("operatorsHint")}</p>
        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} to={expertPath("marks")}>
          {t("toMarks")}
        </Link>
      </div>
      <OperatorActivity profileId={profile.id} />
    </div>
  );
}
