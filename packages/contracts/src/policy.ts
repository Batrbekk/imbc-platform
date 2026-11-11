import type { Role } from './enums.js';

/**
 * PolicyMatrix — права раздела 4 спецификации как данные (GEN-12, D-52, ADR-03).
 * Меняется только релизом через merge request; тесты доступа генерируются из неё.
 * Условия (scope) дополнительно проверяются policy-слоем API:
 *  - own        — объект своей организации / свой профиль;
 *  - visible    — профиль Verified и статус актуальности active/outdated (UPD-02…04);
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
  | 'audit.read';

export type PolicyMatrix = Record<Role, Partial<Record<Action, Scope>>>;

export const POLICY_MATRIX: PolicyMatrix = {
  manufacturer: {
    'profile.read': 'own',
    'profile.edit': 'own',
    'operator_request.reply': 'own',
    'forecast.read': 'after_nda',
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
  },
  observer: {
    'catalog.search': 'visible',
    'dashboard.read': 'visible',
  },
};

export function can(role: Role, action: Action): Scope | null {
  return POLICY_MATRIX[role][action] ?? null;
}
