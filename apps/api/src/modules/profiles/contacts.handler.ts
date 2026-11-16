import {
  contactsWriteSchema,
  contactsReadSchema,
  type CompletenessInput,
  type ContactsRead,
  type ContactsWrite,
  type ProfileContact,
} from '@imbc/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { contact } from '../../database/schema/index.js';
import { assertDictionaryChoice } from './dictionary-choice.js';
import type { SectionContext, TypedSectionHandler } from './section-handler.js';

/** MAN-13–15 / MAN-40: ordered partial drafts; strict normalization precedes any transaction write. */
@Injectable()
export class ContactsHandler implements TypedSectionHandler<ContactsWrite, ContactsRead> {
  readonly kind = 'contacts' as const;
  readonly readSchema = contactsReadSchema;
  parse(input: unknown): ContactsWrite {
    return contactsWriteSchema.parse(input);
  }

  async editable(tx: Database, context: SectionContext): Promise<ContactsWrite> {
    const rows = await tx
      .select({
        fullName: contact.fullName,
        position: contact.position,
        email: contact.email,
        phone: contact.phone,
        roleId: contact.roleId,
        isFocalPoint: contact.isFocalPoint,
      })
      .from(contact)
      .where(and(eq(contact.sectionRevisionId, context.revisionId), eq(contact.organizationId, context.organizationId)))
      .orderBy(asc(contact.positionInList));
    return { contacts: rows };
  }
  read(tx: Database, context: SectionContext): Promise<ContactsRead> {
    return this.editable(tx, context);
  }

  async save(tx: Database, context: SectionContext, input: ContactsWrite): Promise<void> {
    const old = await this.editable(tx, context);
    const matched = new Set<number>();
    const keys = (row: ProfileContact) => [
      ...(row.email ? [JSON.stringify([row.roleId, 'email', row.email])] : []),
      ...(row.phone ? [JSON.stringify([row.roleId, 'phone', row.phone])] : []),
      JSON.stringify([row.roleId, row.fullName, row.position, row.email, row.phone]),
    ];
    const previous = new Map<string, { indices: number[]; cursor: number }>();
    old.contacts.forEach((row, index) => {
      for (const key of keys(row)) {
        let bucket = previous.get(key);
        if (!bucket) {
          bucket = { indices: [], cursor: 0 };
          previous.set(key, bucket);
        }
        bucket.indices.push(index);
      }
    });
    const validatedChoices = new Set<string>();
    for (let index = 0; index < input.contacts.length; index++) {
      const row = input.contacts[index]!;
      // Existing contact choices can survive reorder; they do not make a retired value selectable on a new row.
      let previousIndex = -1;
      for (const key of keys(row)) {
        const bucket = previous.get(key);
        if (!bucket) continue;
        while (bucket.cursor < bucket.indices.length && matched.has(bucket.indices[bucket.cursor]!)) bucket.cursor++;
        if (bucket.cursor < bucket.indices.length) {
          previousIndex = bucket.indices[bucket.cursor++]!;
          break;
        }
      }
      if (previousIndex !== -1) matched.add(previousIndex);
      const choiceKey = `${row.roleId}:${previousIndex !== -1}`;
      if (validatedChoices.has(choiceKey)) continue;
      await assertDictionaryChoice(tx, {
        id: row.roleId,
        dictionaryCode: 'contact_role',
        path: `contacts.${index}.roleId`,
        retainedIds: new Set(previousIndex !== -1 && row.roleId ? [row.roleId] : []),
      });
      validatedChoices.add(choiceKey);
    }
    await tx
      .delete(contact)
      .where(
        and(eq(contact.sectionRevisionId, context.revisionId), eq(contact.organizationId, context.organizationId)),
      );
    // MAN-13: no row-count cap; chunk SQL parameters within the existing atomic section transaction.
    for (let start = 0; start < input.contacts.length; start += 1000)
      await tx.insert(contact).values(
        input.contacts.slice(start, start + 1000).map((row, index) => ({
          ...row,
          sectionRevisionId: context.revisionId,
          organizationId: context.organizationId,
          positionInList: start + index,
        })),
      );
  }

  async mandatoryInputs(tx: Database, context: SectionContext): Promise<CompletenessInput[]> {
    const { contacts } = await this.editable(tx, context);
    return [
      { path: 'contacts', code: 'contacts_too_few', satisfied: contacts.length >= 3 },
      {
        path: 'contacts',
        code: 'focal_point_required',
        satisfied: contacts.filter((row) => row.isFocalPoint).length === 1,
      },
      ...contacts.flatMap((row, index) =>
        (['fullName', 'position', 'email', 'phone', 'roleId'] as const).map((field) => ({
          path: `contacts.${index}.${field}`,
          code: 'required',
          satisfied: Boolean(row[field]),
        })),
      ),
    ];
  }
}
