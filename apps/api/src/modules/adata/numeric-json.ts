/** Transport parser: retain number lexemes before JavaScript rounds provider money or counters. */
export class InvalidAdataJson extends Error {
  constructor(readonly reason: 'invalid_body_size' | 'invalid_json' | 'number_lexeme_unavailable') {
    super(reason);
    this.name = 'InvalidAdataJson';
  }
}

export function parseAdataJson(body: string): unknown {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 5 * 1024 * 1024)
    throw new InvalidAdataJson('invalid_body_size');
  try {
    return JSON.parse(body, (key: string, value: unknown, context?: { source?: string }) => {
      if (typeof value !== 'number') return value;
      if (typeof context?.source !== 'string') throw new InvalidAdataJson('number_lexeme_unavailable');
      // basic.biin is a string-only identity. Never repair a numeric BIN into an accepted string.
      if (key === 'biin') return value;
      return context.source;
    }) as unknown;
  } catch (error) {
    if (error instanceof InvalidAdataJson) throw error;
    // Native SyntaxError can quote the private body. Do not retain it, even as a cause.
    throw new InvalidAdataJson('invalid_json');
  }
}
