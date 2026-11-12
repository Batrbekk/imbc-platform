import { z } from 'zod';
import { PROFILE_STATUSES, PROFILE_TIERS, UPDATE_STATUSES } from './enums.js';

/**
 * Свой профиль производителя, только для чтения (MAN-41, MAN-46, IMBC-22). Только профиль организации
 * сеанса: чужой id в запросе не принимается (GEN-11).
 */
export const ownProfileSchema = z.object({
  /** manufacturer_profiles.id */
  profileId: z.uuid(),
  /** organizations.name, organizations.bin */
  organizationName: z.string(),
  bin: z.string(),
  /** manufacturer_profiles.status (MAN-46). */
  status: z.enum(PROFILE_STATUSES),
  hasPendingChanges: z.boolean(),
  /** Статус актуальности — только после верификации (раздел 5.5). */
  updateStatus: z.enum(UPDATE_STATUSES).nullable(),
  /** null, если не verified; иначе catalog_visible.tier, при отсутствии строки — tier_1 (IMBC-19, IMBC-20). */
  tier: z.enum(PROFILE_TIERS).nullable(),
  /** manufacturer_profiles.completeness_pct (MAN-41). */
  completenessPct: z.number().int().min(0).max(100),
  registeredAt: z.string(),
  verifiedAt: z.string().nullable(),
});
export type OwnProfile = z.infer<typeof ownProfileSchema>;
