/**
 * Флаг сборки прототипа кабинетов ролей (GEN-08, NFR-15). Vite подставляет значение
 * `VITE_PROTOTYPE_CABINETS` при сборке; без "true" прототипа в `dist` нет.
 *
 * Места подключения вне `prototype/` — `router.tsx` и `components/app/app-shell.tsx` — пишут это
 * условие литералом у своего `import()`, а не импортируют константу отсюда: сборщик вырезает чанк
 * динамического импорта, только когда ветка мёртвая в том же модуле (проверено сборкой: с
 * импортированной константой чанки прототипа оставались в dist). `test/prototype-off.test.tsx`
 * сверяет, что выражение там то же и что прототип не импортируется статически.
 */
export const PROTOTYPE = import.meta.env.VITE_PROTOTYPE_CABINETS === "true";

/** Условие флага в исходном тексте мест подключения. */
export const PROTOTYPE_CONDITION = 'import.meta.env.VITE_PROTOTYPE_CABINETS === "true"';
