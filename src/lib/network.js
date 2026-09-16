import dns from 'node:dns/promises';
import net from 'node:net';
import { AppError } from './errors.js';

export async function validatePublicUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new AppError('올바른 URL을 입력하세요.', 400, 'INVALID_URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AppError('HTTP 또는 HTTPS URL만 지원합니다.', 400, 'INVALID_PROTOCOL');
  if (url.username || url.password) throw new AppError('인증 정보가 포함된 URL은 지원하지 않습니다.', 400, 'URL_CREDENTIALS');
  if (url.port && !['80', '443'].includes(url.port)) throw new AppError('표준 웹 포트만 지원합니다.', 400, 'UNSAFE_PORT');

  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new AppError('내부망 또는 로컬 주소에는 접근할 수 없습니다.', 400, 'PRIVATE_ADDRESS');
  }
  return url;
}

export function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') ||
    normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
    normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.');
}

export async function safeFetch(url, options = {}) {
  const validated = await validatePublicUrl(url);
  const response = await fetch(validated, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...options });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    if (!location) throw new AppError('잘못된 리디렉션 응답입니다.', 422, 'BAD_REDIRECT');
    return safeFetch(new URL(location, validated).href, options);
  }
  return response;
}
