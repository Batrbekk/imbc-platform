import type { OrganizationType, Role } from '@imbc/contracts';

/** Тип организации по роли (раздел 3.1): SME, администратор и директор — сотрудники IMBC. */
export const ORGANIZATION_TYPE: Record<Role, OrganizationType> = {
  manufacturer: 'manufacturer',
  expert: 'imbc',
  administrator: 'imbc',
  director: 'imbc',
  operator: 'operator',
  observer: 'observer',
};
