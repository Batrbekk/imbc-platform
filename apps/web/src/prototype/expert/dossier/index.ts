/**
 * Части досье для повторного использования (кабинет директора показывает то же досье только для
 * чтения): компоненты получают профиль или запись и флаг `readOnly`, роль не проверяют; кнопки
 * действий передаёт экран через render-props.
 */
export { DossierSections, SectionReviewStatus } from "./dossier-sections";
export { DueDiligenceView, EnhancedDueDiligenceCard } from "./due-diligence-view";
export { ExternalChecksTable } from "./external-checks-table";
export { referenceLabel, surveyCounts, worksWithOrganizations } from "./helpers";
export { ImbcNotesList } from "./notes-list";
export { OperatorActivity } from "./operator-activity";
export { type ReviewItemRef, SectionView } from "./section-view";
export { SiteSurveyList } from "./site-survey-list";
export { TierRecordsList } from "./tier-records-list";
