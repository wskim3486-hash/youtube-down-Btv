import crypto from 'node:crypto';

const COOKIE = 'media_session';

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createAuth(accessKey) {
  const enabled = Boolean(accessKey);
  const sessionValue = enabled ? crypto.createHmac('sha256', accessKey).update('company-media-session-v1').digest('hex') : '';
  return {
    enabled,
    verifyKey(value) { return enabled && timingSafeEqual(value || '', accessKey); },
    isAuthenticated(req) {
      if (!enabled) return true;
      const cookie = parseCookies(req.headers.cookie || '')[COOKIE];
      return Boolean(cookie && timingSafeEqual(cookie, sessionValue));
    },
    cookie() { return `${COOKIE}=${sessionValue}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`; },
    clearCookie() { return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`; }
  };
}

function parseCookies(header) {
  return Object.fromEntries(header.split(';').map(part => part.trim().split('=')).filter(([key, value]) => key && value));
}
