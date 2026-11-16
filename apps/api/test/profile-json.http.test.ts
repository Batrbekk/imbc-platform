import { PROFILE_JSON_MAX_BYTES } from '@imbc/contracts';
import { Body, Controller, Put } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Can } from '../src/modules/auth/guards.js';
import { type HttpStand, startHttp } from './support/http.js';

let calls = 0;
@Controller('v1/profiles/own/sections')
class JsonProfileController {
  @Put('contacts')
  @Can('profile.edit')
  save(@Body() body: { contacts: unknown[] }) {
    calls++;
    return { count: body.contacts.length };
  }
}

describe('MAN-13 / NFR-09 JSON byte budget', () => {
  let stand: HttpStand;
  beforeAll(async () => {
    stand = await startHttp({ controllers: [JsonProfileController] });
  });
  afterAll(async () => {
    await stand.close();
  });

  it('accepts a large contact list beyond the previous 100 KB parser default', async () => {
    const contacts = Array.from({ length: 160 }, (_, index) => ({ fullName: `Contact ${index} ${'a'.repeat(900)}` }));
    const response = await stand.send('PUT', '/api/v1/profiles/own/sections/contacts', 'manufacturer', { contacts });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 160 });
  });

  it('returns 413 without calling the handler or echoing the oversized data', async () => {
    const before = calls;
    const response = await stand.send('PUT', '/api/v1/profiles/own/sections/contacts', 'manufacturer', {
      contacts: ['private-data ' + 'a'.repeat(PROFILE_JSON_MAX_BYTES)],
    });
    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ code: 'request_too_large' });
    expect(body).not.toContain('private-data');
    expect(calls).toBe(before);
  });

  it('returns a safe validation error for malformed JSON', async () => {
    const response = await fetch(`${stand.base}/api/v1/profiles/own/sections/contacts`, {
      method: 'PUT',
      headers: {
        origin: 'https://imbc.example.kz',
        'content-type': 'application/json',
        cookie: 'imbc-session=manufacturer',
      },
      body: '{"contacts":"private-data',
    });
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ code: 'validation' });
    expect(body).not.toContain('private-data');
  });
});
