// Пример модуля роли для README прототипа и тестов каркаса: один экран с одним действием.
// Настоящие модули лежат в src/prototype/<role>/; этот подменяет модуль оператора в example.test.tsx.
// index.tsx модуля экспортирует только `cabinet`, экраны — в своих файлах (react-refresh).
import { NotebookPenIcon } from "lucide-react";

import { translate } from "@/prototype/i18n";
import { type CabinetModule, protoPath } from "@/prototype/registry";

import { NotesScreen } from "./example-notes";
import { texts } from "./example-texts";

export const cabinet: CabinetModule = {
  role: "operator",
  menu: [{ href: protoPath("operator", "notes"), label: (l) => translate(texts, l, "menu"), icon: NotebookPenIcon }],
  routes: [{ path: "notes", element: <NotesScreen /> }],
};
