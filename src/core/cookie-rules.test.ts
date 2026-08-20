import { describe, expect, it } from 'vitest';
import { cookieIdentity, mapCookieToTarget, validateCookieForTarget } from './cookie-rules';
import type { CookieRecord, TabContext } from './types';

const httpsTarget: TabContext = {
  tabId: 1,
  pageUrl: 'https://app.target.test/account?from=home',
  origin: 'https://app.target.test',
  hostname: 'app.target.test',
  capturedAt: '2026-08-20T06:30:00.000Z',
};

const cookie: CookieRecord = {
  name: 'sid',
  value: 'abc',
  domain: '.source.test',
  path: '/account',
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  session: false,
  expirationDate: 1770000000,
};

describe('cookie rules', () => {
  it('creates a stable identity including partition key', () => {
    expect(cookieIdentity(cookie)).toBe('sid|.source.test|/account|');
    expect(cookieIdentity({ ...cookie, partitionKey: { topLevelSite: 'https://source.test' } })).toBe(
      'sid|.source.test|/account|https://source.test',
    );
  });

  it('maps ordinary cookies to the current host while retaining path and flags', () => {
    const result = mapCookieToTarget(cookie, httpsTarget);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cookie).toMatchObject({
        name: 'sid',
        value: 'abc',
        domain: '.app.target.test',
        path: '/account',
        secure: true,
      });
      expect(result.url).toBe('https://app.target.test/account');
    }
  });

  it('rejects invalid __Host and __Secure constraints', () => {
    expect(validateCookieForTarget({ ...cookie, name: '__Host-sid', domain: '.source.test' }, httpsTarget)).toMatchObject({
      ok: false,
      error: { code: 'COOKIE_CONSTRAINT_INVALID' },
    });
    expect(validateCookieForTarget({ ...cookie, name: '__Secure-sid', secure: false }, httpsTarget)).toMatchObject({
      ok: false,
      error: { code: 'COOKIE_CONSTRAINT_INVALID' },
    });
    expect(
      validateCookieForTarget({ ...cookie, sameSite: 'no_restriction' }, { ...httpsTarget, pageUrl: 'http://app.target.test' , origin: 'http://app.target.test' }),
    ).toMatchObject({ ok: false, error: { code: 'COOKIE_CONSTRAINT_INVALID' } });
  });

  it('rejects secure cookies on an HTTP target and preserves session semantics', () => {
    expect(validateCookieForTarget(cookie, { ...httpsTarget, pageUrl: 'http://app.target.test', origin: 'http://app.target.test' })).toMatchObject({
      ok: false,
      error: { code: 'COOKIE_CONSTRAINT_INVALID' },
    });
    const session = mapCookieToTarget({ ...cookie, session: true, expirationDate: undefined }, httpsTarget);
    expect(session).toMatchObject({ ok: true, cookie: { session: true } });
    if (session.ok) expect(session.cookie.expirationDate).toBeUndefined();
  });
});
