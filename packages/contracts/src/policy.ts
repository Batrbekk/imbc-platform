import type { Role } from './enums.js';

/**
 * PolicyMatrix — права раздела 4 спецификации v1.3 как данные (GEN-10).
 * Меняется только релизом через merge request. Тесты contracts закрепляют матрицу целиком:
 * право, добавленное или снятое без правки их таблицы раздела 4, роняет тест.
 * Права проверяет сервер на каждом запросе, интерфейс только прячет недоступное (GEN-08).
 * Условия (scope) дополнительно проверяются policy-слоем API:
 *  - own        — объект своей организации / свой профиль;
 *  - visible    — профиль Verified и результат due diligence green или amber, при любом
 *                 статусе актуальности: unresponsive остаётся видимым (раздел 4, IMBC-11, UPD-04);
 *  - all        — без ограничения;
 *  - after_nda  — профиль Verified и принята текущая версия NDA (FC-01…03).
 */
export type Scope = 'own' | 'visible' | 'all' | 'after_nda' | 'account_events';

export type Action =
  | 'profile.read'
  | 'profile.edit'
  | 'profile.verify'
  | 'review.take'
  | 'review.assign'
  | 'imbc_records.read'
  | 'imbc_records.edit'
  | 'external_checks.run'
  | 'external_checks.read'
  | 'works_with.validate'
  | 'works_with.read_who'
  | 'accounts.manage'
  | 'reference.manage'
  | 'reference.read'
  // Прогноз, STR и KTRE: одна NDA покрывает все три (раздел 4, FC-01…03).
  | 'forecast.manage'
  | 'forecast.read'
  | 'migration.invite'
  | 'catalog.search'
  | 'dashboard.read'
  | 'catalog.export'
  | 'subscriptions.manage'
  | 'pull_api.manage'
  | 'pull_api.use'
  | 'operator_marks.write'
  | 'operator_notes.read'
  | 'operator_notes.write'
  | 'imbc_request.send'
  | 'imbc_request.answer'
  | 'imbc_request.read'
  | 'operator_request.send'
  | 'operator_request.reply'
  | 'operator_request.read'
  | 'audit.read'
  // Строка «Tier, AGAR, and CDP» раздела 4 (IMBC-19…25).
  | 'tier.read'
  | 'tier.read_products'
  | 'tier.request'
  | 'tier.edit'
  // Focal point: наблюдатель его не видит (GEN-13, OPR-09).
  | 'focal_point.read';

export type PolicyMatrix = Record<Role, Partial<Record<Action, Scope>>>;

export const POLICY_MATRIX: PolicyMatrix = {
  manufacturer: {
    'profile.read': 'own',
    'profile.edit': 'own',
    'operator_request.reply': 'own',
    'forecast.read': 'after_nda',
    'tier.read': 'own',
    'tier.read_products': 'own',
    'tier.request': 'own',
    'focal_point.read': 'own',
  },
  expert: {
    'profile.read': 'all',
    'profile.verify': 'all',
    'review.take': 'all',
    'imbc_records.read': 'all',
    'imbc_records.edit': 'all',
    'external_checks.run': 'all',
    'external_checks.read': 'all',
    'works_with.validate': 'all',
    'works_with.read_who': 'all',
    'catalog.search': 'all',
    'catalog.export': 'all',
    'operator_notes.read': 'all',
    'imbc_request.answer': 'all',
    'imbc_request.read': 'all',
    'operator_request.read': 'all',
    'forecast.read': 'all',
    'tier.read': 'all',
    'tier.read_products': 'all',
    'tier.edit': 'all',
    'focal_point.read': 'all',
  },
  administrator: {
    'review.assign': 'all',
    'accounts.manage': 'all',
    'reference.manage': 'all',
    'reference.read': 'all',
    'forecast.manage': 'all',
    'forecast.read': 'all',
    'migration.invite': 'all',
    'pull_api.manage': 'all',
    'audit.read': 'account_events',
  },
  director: {
    'profile.read': 'all',
    'imbc_records.read': 'all',
    'external_checks.read': 'all',
    'works_with.read_who': 'all',
    'reference.read': 'all',
    'forecast.read': 'all',
    'catalog.search': 'all',
    'dashboard.read': 'all',
    'catalog.export': 'all',
    'operator_notes.read': 'all',
    'imbc_request.read': 'all',
    'operator_request.read': 'all',
    'audit.read': 'all',
    'tier.read': 'all',
    'tier.read_products': 'all',
    'focal_point.read': 'all',
  },
  operator: {
    'catalog.search': 'visible',
    'dashboard.read': 'visible',
    'catalog.export': 'visible',
    'subscriptions.manage': 'own',
    'pull_api.use': 'own',
    'operator_marks.write': 'own',
    'operator_notes.read': 'own',
    'operator_notes.write': 'own',
    'imbc_request.send': 'own',
    'operator_request.send': 'visible',
    'tier.read': 'visible',
    // Только какие продукты в tier 3: не статусы AGAR/CDP и не файлы отчётов (IMBC-26, OPR-09, GEN-09).
    'tier.read_products': 'visible',
    'focal_point.read': 'visible',
  },
  observer: {
    'catalog.search': 'visible',
    'dashboard.read': 'visible',
    'tier.read': 'visible',
  },
};

export function can(role: Role, action: Action): Scope | null {
  return POLICY_MATRIX[role][action] ?? null;
}
