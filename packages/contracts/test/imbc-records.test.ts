import { describe, expect, it } from 'vitest';
import { imbcNoteCreateSchema, imbcNoteUpdateSchema, imbcEngagementPutSchema, imbcProductContextPutSchema, imbcRecordReferenceOptionsQuerySchema } from '../src/imbc-records.js';
const id = '9fba673a-27f1-40d2-8bac-eee003100101';
const engagement = { receiptConfirmed:null,response:null,responseSummary:null,readyForSiteVisit:null,addedToImbcYear:null,
  folderUrl:null,sourceEntryIds:[],eoiEvents:[],expectedUpdatedAt:null };
describe('IMBC historical input boundaries', () => {
  it('rejects manufactured provenance, empty notes, unknown fields and millisecond CAS', () => {
    expect(imbcNoteCreateSchema.safeParse({ body:'note',kind:'legacy_ranking' }).success).toBe(false);
    expect(imbcNoteCreateSchema.safeParse({ body:'  ' }).success).toBe(false);
    expect(imbcNoteCreateSchema.safeParse({ body:'note',authorId:id }).success).toBe(false);
    expect(imbcNoteUpdateSchema.safeParse({ body:'note',expectedUpdatedAt:'2026-11-16T00:00:00.001Z' }).success).toBe(false);
  });
  it('preserves unknown/no and dates, rejects duplicate UUID/date intents and unsafe folder links', () => {
    expect(imbcEngagementPutSchema.parse(engagement).receiptConfirmed).toBe(null);
    expect(imbcEngagementPutSchema.parse({ ...engagement,receiptConfirmed:false }).receiptConfirmed).toBe(false);
    expect(imbcEngagementPutSchema.safeParse({ ...engagement,eoiEvents:[{id,sentOn:'2026-02-30'}] }).success).toBe(false);
    expect(imbcEngagementPutSchema.safeParse({ ...engagement,sourceEntryIds:[id,id.toUpperCase()] }).success).toBe(false);
    expect(imbcEngagementPutSchema.safeParse({ ...engagement,folderUrl:'javascript:alert(1)' }).success).toBe(false);
    expect(imbcEngagementPutSchema.safeParse({ ...engagement,folderUrl:'https://user:pass@example.local/folder' }).success).toBe(false);
    expect(imbcEngagementPutSchema.safeParse({ ...engagement,folderUrl:'https://' }).success).toBe(false);
    expect(imbcEngagementPutSchema.safeParse({ ...engagement,folderUrl:'HTTPS://example.local:443/folder' }).success).toBe(true);
    expect(imbcEngagementPutSchema.safeParse({ ...engagement,folderUrl:'https://example.local:65536/folder' }).success).toBe(false);
    expect(imbcNoteCreateSchema.safeParse({body:'\t\n\u00a0\ufeff'}).success).toBe(false);
    expect(imbcProductContextPutSchema.safeParse({programmeId:null,priorityId:null,expectedUpdatedAt:null,createLps:true}).success).toBe(false);
  });
  it('selected historical dictionary lookup is exact, bounded and separate from pagination', () => {
    expect(imbcRecordReferenceOptionsQuerySchema.parse({ids:id})).toEqual({ids:[id]});
    expect(imbcRecordReferenceOptionsQuerySchema.safeParse({ids:id,offset:0}).success).toBe(false);
    expect(imbcRecordReferenceOptionsQuerySchema.safeParse({ids:id+','+id.toUpperCase()}).success).toBe(false);
    expect(imbcRecordReferenceOptionsQuerySchema.safeParse({ids:''}).success).toBe(false);
    expect(imbcRecordReferenceOptionsQuerySchema.safeParse({ids:'not-a-uuid'}).success).toBe(false);
  });
  it('safely canonicalizes ordinary HTTP(S) IPv6, IDN and trailing-dot folders without throwing', () => {
    for (const [input, expected] of [
      ['HTTPS://Example.local:443', 'https://example.local/'],
      ['https://[2001:0db8:0:0:0:0:0:1]:443/folder', 'https://[2001:db8::1]/folder'],
      ['https://[::ffff:192.0.2.128]/folder', 'https://[::ffff:c000:280]/folder'],
      ['https://пример.рф/папка', 'https://xn--e1afmkfd.xn--p1ai/%D0%BF%D0%B0%D0%BF%D0%BA%D0%B0'],
      ['https://example.local./folder', 'https://example.local./folder'],
      ['https://K.local/folder', 'https://k.local/folder'],
      ['https://ſ.local/folder', 'https://s.local/folder'],
      ['https://example.local/folder?user=person&password=value@safe', 'https://example.local/folder?user=person&password=value@safe'],
    ]) expect(imbcEngagementPutSchema.parse({...engagement,folderUrl:input}).folderUrl).toBe(expected);
    for (const input of ['https://', 'https://[not-ipv6]/folder', 'https://example.local:65536/folder',
      'https://user:pass@example.local/folder', 'https://@example.local/folder', 'javascript:alert(1)', 'https://exa\nmple.local/folder'])
      expect(imbcEngagementPutSchema.safeParse({...engagement,folderUrl:input}).success).toBe(false);
  });
});
