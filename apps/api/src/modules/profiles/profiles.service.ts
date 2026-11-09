import { PROFILE_SECTIONS } from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../../database/database.module.js';
import { manufacturerProfiles, profileSections, sectionRevisions } from '../../database/schema/index.js';

/**
 * Профиль производителя. Каркас: создание Draft с восемью секциями и рабочими редакциями.
 * Редактирование секций, полнота, отправка, разблокировка и pending changes —
 * следующие итерации (архитектура §7–8, MAN-10…96).
 */
@Injectable()
export class ProfilesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Профиль Draft с восемью секциями (MAN-03). Создаётся при регистрации — Draft виден
   * только производителю и IMBC (MAN-04) — и при первом входе, если его ещё нет. Идемпотентно.
   */
  async ensureDraft(
    organizationId: string,
    authorId: string,
    opts: { heardAboutUs?: string | null; outer?: Database } = {},
  ): Promise<string> {
    return (opts.outer ?? this.db).transaction(async (tx) => {
      const existing = await tx.query.manufacturerProfiles.findFirst({
        where: eq(manufacturerProfiles.organizationId, organizationId),
      });
      if (existing) return existing.id;

      const [profile] = await tx
        .insert(manufacturerProfiles)
        .values({ organizationId, heardAboutUs: opts.heardAboutUs ?? null })
        .onConflictDoNothing({ target: manufacturerProfiles.organizationId })
        .returning({ id: manufacturerProfiles.id });
      if (!profile) {
        const raced = await tx.query.manufacturerProfiles.findFirst({
          where: eq(manufacturerProfiles.organizationId, organizationId),
        });
        return raced!.id;
      }

      for (const kind of PROFILE_SECTIONS) {
        const [section] = await tx
          .insert(profileSections)
          .values({ profileId: profile.id, kind })
          .returning({ id: profileSections.id });
        const [revision] = await tx
          .insert(sectionRevisions)
          .values({ sectionId: section!.id, number: 1, authorId })
          .returning({ id: sectionRevisions.id });
        await tx
          .update(profileSections)
          .set({ workingRevisionId: revision!.id })
          .where(eq(profileSections.id, section!.id));
      }
      return profile.id;
    });
  }
}
