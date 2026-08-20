import type {
  CookieMappingResult,
  CookieRecord,
  RuntimeError,
  TabContext,
} from './types';

function constraint(message: string): { ok: false; error: RuntimeError } {
  return {
    ok: false,
    error: { code: 'COOKIE_CONSTRAINT_INVALID', message },
  };
}

function normalizedDomain(domain: string): string {
  return domain.replace(/^\./, '').toLowerCase();
}

function partitionIdentity(cookie: CookieRecord): string {
  return cookie.partitionKey?.topLevelSite ?? '';
}

export function cookieIdentity(cookie: CookieRecord): string {
  return [cookie.name, cookie.domain.toLowerCase(), cookie.path || '/', partitionIdentity(cookie)].join('|');
}

export function validateCookieForTarget(
  cookie: CookieRecord,
  target: TabContext,
): { ok: true } | { ok: false; error: RuntimeError } {
  let targetUrl: URL;
  try {
    targetUrl = new URL(target.pageUrl);
  } catch {
    return constraint('The target page URL is invalid.');
  }

  if (!cookie.name || !cookie.path.startsWith('/')) {
    return constraint('Cookie name and path are invalid.');
  }
  if (!['no_restriction', 'lax', 'strict', 'unspecified'].includes(cookie.sameSite)) {
    return constraint('Cookie SameSite value is invalid.');
  }
  if (cookie.secure && targetUrl.protocol !== 'https:') {
    return constraint('Secure cookies require an HTTPS target.');
  }
  if (cookie.sameSite === 'no_restriction' && !cookie.secure) {
    return constraint('SameSite=None cookies must be Secure.');
  }
  if (cookie.name.startsWith('__Secure-') && !cookie.secure) {
    return constraint('__Secure- cookies must be Secure.');
  }
  if (
    cookie.name.startsWith('__Host-') &&
    (!cookie.secure || cookie.path !== '/' || cookie.domain.startsWith('.') || cookie.hostOnly !== true)
  ) {
    return constraint('__Host- cookies must be Secure, host-only, and use path /.');
  }
  if (!cookie.session && cookie.expirationDate !== undefined && !Number.isFinite(cookie.expirationDate)) {
    return constraint('Cookie expiration is invalid.');
  }

  return { ok: true };
}

export function mapCookieToTarget(cookie: CookieRecord, target: TabContext): CookieMappingResult {
  const validation = validateCookieForTarget(cookie, target);
  if (!validation.ok) return validation;

  const targetUrl = new URL(target.pageUrl);
  targetUrl.search = '';
  targetUrl.hash = '';
  targetUrl.pathname = cookie.path || '/';

  const hostOnly = cookie.name.startsWith('__Host-') || cookie.hostOnly === true;
  const domain = hostOnly ? target.hostname : `.${target.hostname}`;
  const mapped: CookieRecord = {
    ...cookie,
    domain,
    path: cookie.path || '/',
    hostOnly,
  };

  if (mapped.session) delete mapped.expirationDate;

  return {
    ok: true,
    cookie: mapped,
    url: targetUrl.toString(),
    remapped: normalizedDomain(cookie.domain) !== target.hostname.toLowerCase(),
  };
}

