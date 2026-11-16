import { z } from 'zod';
import { draftEmailSchema, draftPhoneSchema, draftTextSchema } from './profile-fields.js';
import { sectionReadSchema, sectionSaveInputSchema } from './profile-sections.js';

export const profileContactSchema = z.strictObject({
  fullName: draftTextSchema,
  position: draftTextSchema,
  email: draftEmailSchema,
  phone: draftPhoneSchema,
  roleId: z.uuid().nullable(),
  isFocalPoint: z.boolean(),
});
export type ProfileContact = z.infer<typeof profileContactSchema>;

/** MAN-13–15: any number of draft rows; duplicates and a second focal point reject the entire save. */
export const contactsWriteSchema = z
  .strictObject({ contacts: z.array(profileContactSchema) })
  .superRefine(({ contacts }, ctx) => {
    const emails = new Set<string>();
    const phones = new Set<string>();
    let focal = false;
    contacts.forEach((contact, index) => {
      if (contact.email && emails.has(contact.email))
        ctx.addIssue({ code: 'custom', message: 'duplicate_email', path: ['contacts', index, 'email'] });
      if (contact.phone && phones.has(contact.phone))
        ctx.addIssue({ code: 'custom', message: 'duplicate_phone', path: ['contacts', index, 'phone'] });
      if (contact.isFocalPoint && focal)
        ctx.addIssue({ code: 'custom', message: 'multiple_focal_points', path: ['contacts', index, 'isFocalPoint'] });
      if (contact.email) emails.add(contact.email);
      if (contact.phone) phones.add(contact.phone);
      if (contact.isFocalPoint) focal = true;
    });
  });
export type ContactsWrite = z.infer<typeof contactsWriteSchema>;
export const contactsReadSchema = contactsWriteSchema;
export type ContactsRead = ContactsWrite;
export const ownContactsSchema = sectionReadSchema(contactsReadSchema);
export const saveContactsSchema = sectionSaveInputSchema(contactsWriteSchema);
