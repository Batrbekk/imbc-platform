import { describe, expect, it } from 'vitest';
import { contactsWriteSchema, mainInformationWriteSchema, normalizeProfilePhone } from '../src/index.js';

const roleId = '20000000-0000-4000-8000-000000000001';
const person = (index: number) => ({
  fullName: `Contact ${index}`,
  position: 'Engineer',
  email: `contact${index}@example.local`,
  phone: `+44 20 7000 ${String(index).padStart(4, '0')}`,
  roleId,
  isFocalPoint: index === 0,
});
const main = { website: null, companyPhone: null, contactEmail: null, sites: [] };

describe('MAN-06–15 / MAN-40 profile write contracts', () => {
  it('saves incomplete main information and contacts without source confirmation', () => {
    expect(mainInformationWriteSchema.parse(main)).toEqual(main);
    expect(contactsWriteSchema.parse({ contacts: [] })).toEqual({ contacts: [] });
    expect(
      contactsWriteSchema.parse({ contacts: [{ ...person(0), fullName: '', email: null, roleId: null }] }).contacts[0],
    ).toMatchObject({ fullName: null, email: null, roleId: null });
  });

  it.each([
    'legalName',
    'legalForm',
    'legalAddress',
    'directorFullName',
    'founders',
    'oked',
    'bin',
    'loginEmail',
    'confirm',
  ])('refuses readonly %s in a direct write', (field) => {
    expect(mainInformationWriteSchema.safeParse({ ...main, [field]: 'changed' }).success).toBe(false);
  });

  it('has no upper contact count and permits repeated roles', () => {
    expect(
      contactsWriteSchema.parse({ contacts: Array.from({ length: 75 }, (_, index) => person(index)) }).contacts,
    ).toHaveLength(75);
  });

  it('normalizes email and international phones before rejecting equivalent duplicates', () => {
    const duplicateEmail = contactsWriteSchema.safeParse({
      contacts: [person(0), { ...person(1), email: ' CONTACT0@EXAMPLE.LOCAL ' }],
    });
    expect(duplicateEmail.success).toBe(false);
    if (!duplicateEmail.success)
      expect(duplicateEmail.error.issues).toContainEqual(
        expect.objectContaining({ message: 'duplicate_email', path: ['contacts', 1, 'email'] }),
      );
    const duplicatePhone = contactsWriteSchema.safeParse({
      contacts: [person(0), { ...person(1), phone: '0044 (20) 7000-0000' }],
    });
    expect(duplicatePhone.success).toBe(false);
    if (!duplicatePhone.success)
      expect(duplicatePhone.error.issues).toContainEqual(
        expect.objectContaining({ message: 'duplicate_phone', path: ['contacts', 1, 'phone'] }),
      );
  });

  it('rejects a second focal point without silently changing the first', () => {
    const input = { contacts: [person(0), { ...person(1), isFocalPoint: true }] };
    const parsed = contactsWriteSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ message: 'multiple_focal_points', path: ['contacts', 1, 'isFocalPoint'] }),
      );
    expect(input.contacts.every((contact) => contact.isFocalPoint)).toBe(true);
  });

  it.each(['+7 (701) 123-45-67', '+1 202-555-0123', '+44 20 7946 0958', '0049 30 123456'])(
    'accepts the international format %s',
    (phone) => expect(normalizeProfilePhone(phone)).not.toBeNull(),
  );
  it.each(['87011234567', '02079460958', '+0 123456789', '+123', '+1 202 555 0123 ext 4', 'phone'])(
    'refuses an ambiguous or malformed phone %s',
    (phone) => expect(normalizeProfilePhone(phone)).toBeNull(),
  );

  it('validates optional company fields when supplied', () => {
    const parsed = mainInformationWriteSchema.parse({
      ...main,
      companyPhone: '+44 20 7946 0958',
      contactEmail: ' INFO@EXAMPLE.LOCAL ',
      website: 'https://example.local',
    });
    expect(parsed).toMatchObject({
      companyPhone: '+442079460958',
      contactEmail: 'info@example.local',
      website: 'https://example.local/',
    });
    for (const website of ['javascript:alert(1)', 'https://user:password@example.local', 'example.local'])
      expect(mainInformationWriteSchema.safeParse({ ...main, website }).success).toBe(false);
  });

  it('rejects a repeated stable site identity and permits several new sites', () => {
    const site = { identityId: roleId, address: '', city: null, regionId: null };
    expect(mainInformationWriteSchema.safeParse({ ...main, sites: [site, site] }).success).toBe(false);
    expect(
      mainInformationWriteSchema.parse({
        ...main,
        sites: [
          { ...site, identityId: null },
          { ...site, identityId: null },
        ],
      }).sites,
    ).toHaveLength(2);
  });
});
