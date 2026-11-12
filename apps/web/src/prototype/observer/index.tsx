import type { CabinetModule } from "../registry";

/** Кабинет наблюдателя: по GEN-13 новых разделов нет, модуль остаётся пустым — группы «Прототип» в меню у наблюдателя нет. */
export const cabinet: CabinetModule = {
  role: "observer",
  menu: [],
  routes: [],
};
