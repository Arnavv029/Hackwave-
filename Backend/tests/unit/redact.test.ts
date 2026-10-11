import { describe, expect, it } from 'vitest';
import { REDACTED, redactHeaders, redactText, redactValue, sanitizeUrl } from '../../src/security/redact.js';

describe('redactValue', () => {
  it('replaces credential-like keys at any depth and keeps everything else', () => {
    const out = redactValue({
      amount: -50,
      currency: 'USD',
      source_token: 'tok_visa',
      customer: { email: 'a@b.c', password: 'hunter2', card: { card_number: '4242', cvv: '123' } },
      meta: { api_key: 'k', refresh_token: 'r', clientSecret: 's', nested: { Authorization: 'Bearer x' } },
      list: [{ token: 't1' }, { token: 't2', ok: 1 }],
    }) as Record<string, unknown>;
    expect(out['amount']).toBe(-50);
    expect(out['currency']).toBe('USD');
    expect(out['source_token']).toBe(REDACTED);
    const customer = out['customer'] as Record<string, unknown>;
    expect(customer['email']).toBe('a@b.c');
    expect(customer['password']).toBe(REDACTED);
    expect((customer['card'] as Record<string, unknown>)['card_number']).toBe(REDACTED);
    const meta = out['meta'] as Record<string, unknown>;
    expect(Object.values(meta).slice(0, 3)).toEqual([REDACTED, REDACTED, REDACTED]);
    expect((meta['nested'] as Record<string, unknown>)['Authorization']).toBe(REDACTED);
    expect(out['list']).toEqual([{ token: REDACTED }, { token: REDACTED, ok: 1 }]);
  });

  it('redacts sensitive-looking values under innocent keys and whole sensitive subtrees', () => {
    const out = redactValue({
      note: 'Bearer abc.def.ghi',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ',
      key: 'sk_live_1234567890abcdef',
      credentials: { user: 'u', pass: 'p' },
      name: 'fine',
    }) as Record<string, unknown>;
    expect(out['note']).toBe(REDACTED);
    expect(out['jwt']).toBe(REDACTED);
    expect(out['key']).toBe(REDACTED);
    expect(out['credentials']).toEqual({ user: REDACTED, pass: REDACTED });
    expect(out['name']).toBe('fine');
  });

  it('redacts xAI keys, webhook secrets, and private keys', () => {
    const out = redactValue({
      xai_key: 'xai-9876543210fedcba',
      webhook_secret: 'whsec_abcdef123456',
      signing_key: 'secret-signing-key',
    }) as Record<string, unknown>;
    expect(out['xai_key']).toBe(REDACTED);
    expect(out['webhook_secret']).toBe(REDACTED);
    expect(out['signing_key']).toBe(REDACTED);
  });

  it('bounds recursion depth', () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 30; i += 1) deep = { child: deep };
    expect(JSON.stringify(redactValue(deep))).toContain('[TRUNCATED_DEPTH]');
  });
});

describe('redactHeaders', () => {
  it('keeps allow-listed headers, names sensitive ones, omits the rest', () => {
    const r = redactHeaders([
      ['Content-Type', 'application/json'],
      ['Retry-After', '30'],
      ['Set-Cookie', 'sid=secret'],
      ['Authorization', 'Bearer t'],
      ['X-Internal-Debug', 'whatever'],
    ]);
    expect(r.kept).toEqual({ 'content-type': 'application/json', 'retry-after': '30' });
    expect(r.redacted).toEqual(['authorization', 'set-cookie']);
    expect(r.omitted).toEqual(['x-internal-debug']);
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it('accepts node-style header records with array values', () => {
    const r = redactHeaders({ cookie: ['a=1', 'b=2'], 'x-api-key': 'k', 'content-length': '12', missing: undefined });
    expect(r.redacted).toEqual(['cookie', 'x-api-key']);
    expect(r.kept['content-length']).toBe('12');
  });
});

describe('redactText / sanitizeUrl', () => {
  it('scrubs bearer tokens, jwts, key=value secrets and connection-string passwords', () => {
    const text = 'Authorization: Bearer abcdef123456 token=xyz987 postgresql://u:pw@host/db eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
    const out = redactText(text);
    expect(out).not.toContain('abcdef123456');
    expect(out).not.toContain('xyz987');
    expect(out).not.toContain(':pw@');
    expect(out).not.toContain('eyJhbGci');
  });

  it('keeps the path and query names but drops query values', () => {
    expect(sanitizeUrl('http://h/mock/shipping/shipments?page=2&size=5&api_key=secret')).toEqual({
      path: '/mock/shipping/shipments',
      queryKeys: ['api_key', 'page', 'size'],
    });
  });
});
