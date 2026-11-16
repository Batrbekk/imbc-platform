import { z } from 'zod';
import { registrationTermsSchema } from './registration.js';

/** A tick names the displayed current version, not client-selected consent evidence. */
export const acceptCurrentNdaInputSchema = z.strictObject({
  versionNumber: z.number().int().positive(),
  accepted: z.literal(true),
});
export type AcceptCurrentNdaInput = z.infer<typeof acceptCurrentNdaInputSchema>;
export const currentNdaStateSchema = registrationTermsSchema
  .extend({
    accepted: z.boolean(),
    acceptedAt: z.iso.datetime().nullable(),
    profileLinked: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.accepted !== (value.acceptedAt !== null) || (value.profileLinked && !value.accepted))
      context.addIssue({ code: 'custom', path: ['accepted'], message: 'invalid_nda_evidence' });
  });
export type CurrentNdaState = z.infer<typeof currentNdaStateSchema>;
