import { randomUUID } from 'node:crypto';
import { COMPANY_ISO_CODES, type SectionKind } from '@imbc/contracts';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as s from '../../src/database/schema/index.js';
import type { AuthUser } from '../../src/modules/auth/auth.types.js';
import { CertificatesHandler } from '../../src/modules/profiles/certificates.handler.js';
import { ContactsHandler } from '../../src/modules/profiles/contacts.handler.js';
import { DocumentsHandler } from '../../src/modules/profiles/documents.handler.js';
import { MainInformationHandler } from '../../src/modules/profiles/main-information.handler.js';
import { PersonnelHandler } from '../../src/modules/profiles/personnel.handler.js';
import { ProductionHandler } from '../../src/modules/profiles/production.handler.js';
import { ProductsHandler } from '../../src/modules/profiles/products.handler.js';
import { defineSectionHandler } from '../../src/modules/profiles/section-handler.js';
import { seedProfileGraph } from './profile-graph.js';

export const submissionHandlers = () => [
  defineSectionHandler(new MainInformationHandler()),
  defineSectionHandler(new ContactsHandler()),
  defineSectionHandler(new PersonnelHandler()),
  defineSectionHandler(new DocumentsHandler()),
  defineSectionHandler(new CertificatesHandler()),
  defineSectionHandler(new ProductsHandler()),
  defineSectionHandler(new ProductionHandler()),
];

let fixtureBin = 0;

/** Complete producer-entered graph, while legal source fields and optional equipment details remain unknown. */
export async function seedSubmissionProfile(pool: pg.Pool, base?: { profile: string; org: string }) {
  const db = drizzle(pool, { schema: s, casing: 'snake_case' });
  const graph = await seedProfileGraph(pool, base);
  // Existing query fixtures keep their original BIN/identity; the default isolated fixture is unchanged.
  if (!base)
    await db
      .update(s.organizations)
      .set({ bin: `2710${String(++fixtureBin).padStart(8, '0')}` })
      .where(eq(s.organizations.id, graph.org));
  const [owner] = await db
    .insert(s.userAccounts)
    .values({
      organizationId: graph.org,
      role: 'manufacturer',
      state: 'active',
      email: `${randomUUID()}@submit.local`,
      locale: 'en',
    })
    .returning();
  const actor: AuthUser = {
    id: owner!.id,
    organizationId: graph.org,
    email: owner!.email,
    fullName: null,
    role: 'manufacturer',
    organizationType: 'manufacturer',
    locale: 'en',
  };
  const entry = async (dictionaryCode: string, code: string, extra: Record<string, unknown> = {}) => {
    const [dictionary] = await db.select().from(s.dictionary).where(eq(s.dictionary.code, dictionaryCode));
    const [existing] = await db
      .select()
      .from(s.dictionaryEntry)
      .where(and(eq(s.dictionaryEntry.dictionaryId, dictionary!.id), eq(s.dictionaryEntry.code, code)));
    const row =
      existing ??
      (
        await db
          .insert(s.dictionaryEntry)
          .values({ dictionaryId: dictionary!.id, code, ...extra })
          .returning()
      )[0]!;
    await db
      .insert(s.dictionaryEntryTranslation)
      .values(
        (['en', 'ru', 'kk'] as const).map((language) => ({
          dictionaryEntryId: row.id,
          language,
          name: `Fixture ${code} ${language}`,
        })),
      )
      .onConflictDoNothing();
    return row.id;
  };
  const region = await entry('region', 'submit_region');
  const role = await entry('contact_role', 'management');
  const group = await entry('commodity_group', 'A');
  const commodityType = await entry('commodity_type', 'submit_type', { parentEntryId: group });
  const tnVed = await entry('tn_ved', '0012345678');
  const unit = await entry('unit', 'pieces');
  await db
    .update(s.mainInformation)
    .set({ companyPhone: '+7 777 111 2233' })
    .where(eq(s.mainInformation.id, String(graph.rows.main_information!.id)));
  await db
    .update(s.productionSite)
    .set({ address: 'Factory street', city: 'Almaty', regionId: region })
    .where(eq(s.productionSite.id, String(graph.rows.production_site!.id)));
  await db
    .update(s.contact)
    .set({
      fullName: 'Focal person',
      position: 'Manager',
      email: 'focal@submit.local',
      phone: '+7 777 111 0001',
      roleId: role,
      isFocalPoint: true,
    })
    .where(eq(s.contact.id, String(graph.rows.contact!.id)));
  await db.insert(s.contact).values(
    [2, 3].map((index) => ({
      sectionRevisionId: graph.revisions.contacts!,
      organizationId: graph.org,
      fullName: `Person ${index}`,
      position: 'Contact',
      email: `contact${index}@submit.local`,
      phone: `+7 777 111 000${index}`,
      roleId: role,
      positionInList: index - 1,
    })),
  );
  await db
    .update(s.personnel)
    .set({ managersCount: 0, engineersCount: 0, productionWorkersCount: 0, nonresidentCount: 0 })
    .where(eq(s.personnel.id, String(graph.rows.personnel!.id)));
  await db
    .update(s.productLine)
    .set({
      nameEn: 'Widget',
      nameRu: 'Изделие',
      commodityTypeId: commodityType,
      tnVedEntryId: tnVed,
      tnVedCode: '0012345678',
      capacityQuantity: '9007199254740993',
      capacityUnitId: unit,
    })
    .where(eq(s.productLine.id, String(graph.rows.product_line!.id)));
  const other = await entry('certificate_type', 'other');
  await db
    .update(s.certificate)
    .set({
      certificateTypeId: other,
      customTypeName: 'Product fixture',
      number: 'CERT-1',
      issuingBody: 'Fixture body',
      issuedOn: '2026-01-01',
    })
    .where(eq(s.certificate.id, String(graph.rows.certificate!.id)));
  for (const code of COMPANY_ISO_CODES) {
    const type = await entry('certificate_type', code);
    const [identity] = await db
      .insert(s.certificateIdentity)
      .values({ profileId: graph.profile, organizationId: graph.org })
      .returning();
    await db.insert(s.certificate).values({
      sectionRevisionId: graph.revisions.certificates!,
      organizationId: graph.org,
      identityId: identity!.id,
      certificateTypeId: type,
      group: 'company',
      notHeld: true,
    });
  }
  const registration = await entry('document_type', 'registration_certificate');
  const charter = await entry('document_type', 'charter');
  await db
    .update(s.document)
    .set({ documentTypeId: registration })
    .where(eq(s.document.id, String(graph.rows.document!.id)));
  const [charterIdentity] = await db
    .insert(s.documentIdentity)
    .values({ profileId: graph.profile, organizationId: graph.org })
    .returning();
  const [file] = await db
    .insert(s.fileObject)
    .values({ organizationId: graph.org, purpose: 'document_file', dataClass: 'b_manufacturer' })
    .returning();
  await db.insert(s.fileVersion).values({
    fileObjectId: file!.id,
    versionNumber: 1,
    originalName: 'charter.pdf',
    byteSize: 1,
    declaredMediaType: 'application/pdf',
    checksum: 'fixture',
    storageKey: randomUUID(),
    scanState: 'passed',
  });
  await db.insert(s.document).values({
    sectionRevisionId: graph.revisions.documents!,
    organizationId: graph.org,
    identityId: charterIdentity!.id,
    documentTypeId: charter,
    fileObjectId: file!.id,
    positionInList: 1,
  });
  return {
    ...graph,
    actor,
    sections: Object.fromEntries(
      (await db.select().from(s.profileSection).where(eq(s.profileSection.profileId, graph.profile))).map((section) => [
        section.kind,
        section.id,
      ]),
    ) as Record<SectionKind, string>,
  };
}
