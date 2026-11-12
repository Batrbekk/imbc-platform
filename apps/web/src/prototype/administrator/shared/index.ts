/**
 * Части экранов администратора для показа, которые берёт и кабинет директора (только чтение, GEN-04):
 * данные и `readOnly` передаёт вызывающий экран, роль компоненты не проверяют.
 */
export { ForecastLinesView, ForecastProblemsView, ForecastVersionsView } from "./forecast-view";
export { NdaVersionsView } from "./nda-versions-view";
export { hasMandatoryMark, type TechProduct, techProducts } from "./model";
export { OrgChartSampleView, ReferenceListView } from "./reference-list-view";
export { TechFilesView } from "./tech-files-view";
export { sharedTexts } from "./texts";
