// Файлы STR и KTRE для генерального директора IMBC — только просмотр (GEN-04, раздел 4: «view»), Release 2:
// по товарным группам, в группе — по продуктам (ADM-15, FC-08). Часть экрана — из кабинета администратора с `readOnly`.
import { TechFilesView } from "@/prototype/administrator/shared";
import { ProtoPage } from "@/prototype/components";
import { useDictionary } from "@/prototype/i18n";
import { useProto } from "@/prototype/store";

import { libraryTexts } from "./library-texts";

export function TechFilesScreen() {
  const t = useDictionary(libraryTexts);
  const files = useProto((s) => s.techFiles);
  return (
    <ProtoPage hideReset release2 title={t("techTitle")} description={t("techHint")}>
      <TechFilesView files={files} readOnly />
    </ProtoPage>
  );
}
