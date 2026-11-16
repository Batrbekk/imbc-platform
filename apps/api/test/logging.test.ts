import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { httpLoggerOptions, redactLogLine } from '../src/common/logging.js';

describe('log sanitization at the common emission boundary', () => {
  it('scrubs child bindings, nested URL attributes, credentials and errors before every destination write', () => {
    const lines: string[] = [];
    const logger = pino(httpLoggerOptions({ LOG_LEVEL: 'info', NODE_ENV: 'test' }), {
      write: (line: string) => void lines.push(line),
    });
    const child = logger.child({
      jobId: 'safe-job-id',
      attributes: {
        'url.full':
          'https://basic-user-fixture:basic-password-fixture@api.fixture.local/process?access_token=attribute-token-fixture#fragment-secret-fixture',
        'url.query': 'code=attribute-code-fixture&state=attribute-state-fixture',
        'http.request.header.referer': 'https://ref.fixture.local/?code=ref-attribute-fixture',
      },
    });
    child.info(
      {
        request: {
          url: '/api/auth/callback?code=nested-code-fixture&state=nested-state-fixture',
          headers: {
            authorization: 'Bearer nested-header-fixture',
            referer: 'https://private.fixture.local/private-path',
          },
        },
        credentials: {
          client_secret: 'client-secret-fixture',
          accessToken: 'access-token-fixture',
          refresh_token: 'refresh-token-fixture',
          code_verifier: 'verifier-fixture',
          password: 'password-fixture',
        },
        statusCode: 200,
        errorCode: 'file_invalid',
        traceId: 'safe-trace-id',
      },
      'processed request',
    );
    child.error(
      new Error(
        'Failed at https://error-user-fixture:error-password-fixture@remote.fixture.local/task?code=error-code-fixture&state=error-state-fixture',
      ),
    );
    child.warn('OIDC failed: code=text-code-fixture state=text-state-fixture Bearer text-token-fixture');
    const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries[0]).toMatchObject({
      jobId: 'safe-job-id',
      statusCode: 200,
      errorCode: 'file_invalid',
      traceId: 'safe-trace-id',
      request: {
        url: '/api/auth/callback?[Redacted]',
        headers: { authorization: '[Redacted]', referer: '[Redacted]' },
      },
      credentials: {
        client_secret: '[Redacted]',
        accessToken: '[Redacted]',
        refresh_token: '[Redacted]',
        code_verifier: '[Redacted]',
        password: '[Redacted]',
      },
      attributes: {
        'url.full': 'https://[Redacted]@api.fixture.local/process?[Redacted]',
        'url.query': '[Redacted]',
        'http.request.header.referer': '[Redacted]',
      },
    });
    expect(entries[2]!.msg).toBe('OIDC failed: code=[Redacted] state=[Redacted] Bearer [Redacted]');
    const output = lines.join('');
    for (const secret of [
      'basic-user-fixture',
      'basic-password-fixture',
      'attribute-token-fixture',
      'fragment-secret-fixture',
      'attribute-code-fixture',
      'attribute-state-fixture',
      'ref-attribute-fixture',
      'nested-code-fixture',
      'nested-state-fixture',
      'nested-header-fixture',
      'private-path',
      'client-secret-fixture',
      'access-token-fixture',
      'refresh-token-fixture',
      'verifier-fixture',
      'password-fixture',
      'error-user-fixture',
      'error-password-fixture',
      'error-code-fixture',
      'error-state-fixture',
      'text-code-fixture',
      'text-state-fixture',
      'text-token-fixture',
    ])
      expect(output, secret).not.toContain(secret);
  });

  it('keeps safe messages and data while redacting URL fragments and unknown query values', () => {
    const safe = {
      level: 30,
      msg: 'Scan passed',
      fileId: 'fixture-file',
      versionNumber: 1,
      code: 'NOT-02',
      href: '/files/download#fragment-fixture',
      redirectTo: '/login?error=arbitrary-query-fixture',
      url: 'https://service.fixture.local/data',
      referenceCode: '001234',
    };
    expect(JSON.parse(redactLogLine(JSON.stringify(safe)))).toEqual({
      ...safe,
      href: '/files/download#[Redacted]',
      redirectTo: '/login?[Redacted]',
    });
    expect(
      JSON.parse(
        redactLogLine(
          JSON.stringify({
            level: 50,
            msg: 'Unable to connect to postgres://db-user-fixture:db-password-fixture@database.fixture.local:5432/imbc?options=connection-secret-fixture',
          }),
        ),
      ).msg,
    ).toBe('Unable to connect to postgres://[Redacted]@database.fixture.local:5432/imbc?[Redacted]');
  });

  it('does not leak malformed records and never throws into the request', () => {
    for (const line of ['malformed-secret-fixture', '{"token":"truncated-secret-fixture"', 'null', '[]', '42']) {
      const result = redactLogLine(line);
      expect(JSON.parse(result)).toEqual({ level: 50, msg: 'Invalid log record redacted' });
      expect(result).not.toContain('secret-fixture');
    }
  });
});
