import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { createRegistry } from './providers/index.js';
import { validatePublicUrl } from './lib/network.js';
import { AppError, publicError } from './lib/errors.js';
import { createAuth } from './auth.js';
import { JobManager, publicJob } from './jobs.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, 'public');
const registry = createRegistry(config);
const auth = createAuth(config.accessKey);
const jobs = new JobManager(config);
await jobs.init();

if (config.isProduction && !auth.enabled) throw new Error('NODE_ENV=production에서는 APP_ACCESS_KEY가 필수입니다.');

const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, authRequired: auth.enabled });
    if (req.method === 'POST' && url.pathname === '/api/login') return await login(req, res);
    if (req.method === 'POST' && url.pathname === '/api/logout') { res.setHeader('Set-Cookie', auth.clearCookie()); return json(res, 200, { ok: true }); }
    if (url.pathname.startsWith('/api/') && !auth.isAuthenticated(req)) throw new AppError('접근 키로 로그인하세요.', 401, 'UNAUTHORIZED');
    if (req.method === 'POST' && url.pathname === '/api/analyze') return await analyze(req, res);
    if (req.method === 'POST' && url.pathname === '/api/downloads') return await createDownload(req, res);
    const jobMatch = url.pathname.match(/^\/api\/downloads\/([a-f0-9-]+)$/);
    if (req.method === 'GET' && jobMatch) return json(res, 200, publicJob(jobs.get(jobMatch[1])));
    const fileMatch = url.pathname.match(/^\/api\/downloads\/([a-f0-9-]+)\/file$/);
    if (req.method === 'GET' && fileMatch) return await sendDownload(res, jobs.get(fileMatch[1]));
    if (req.method === 'GET') return await serveStatic(url.pathname, res);
    throw new AppError('요청한 경로를 찾을 수 없습니다.', 404, 'NOT_FOUND');
  } catch (error) {
    const result = publicError(error);
    json(res, result.status, result.body);
  }
});

async function login(req, res) {
  if (!auth.enabled) return json(res, 200, { ok: true, authRequired: false });
  const body = await readJson(req);
  if (!auth.verifyKey(body.accessKey)) throw new AppError('접근 키가 올바르지 않습니다.', 401, 'INVALID_ACCESS_KEY');
  res.setHeader('Set-Cookie', auth.cookie());
  return json(res, 200, { ok: true, authRequired: true });
}

async function analyze(req, res) {
  const body = await readJson(req);
  const sourceUrl = await validatePublicUrl(body.url);
  const provider = registry.resolve(sourceUrl);
  const result = await provider.analyze(sourceUrl);
  return json(res, 200, result);
}

async function createDownload(req, res) {
  const body = await readJson(req);
  if (!body.metadata || !['video', 'audio'].includes(body.mode)) throw new AppError('다운로드 요청이 올바르지 않습니다.', 400, 'INVALID_DOWNLOAD');
  const sourceUrl = await validatePublicUrl(body.metadata.sourceUrl);
  const provider = registry.all.find(item => item.id === body.metadata.provider && item.matches(sourceUrl));
  if (!provider) throw new AppError('분석 결과와 Provider가 일치하지 않습니다.', 400, 'PROVIDER_MISMATCH');
  const allowedFormats = new Set((body.metadata.formats || []).map(item => String(item.id)));
  if (body.mode === 'video' && !allowedFormats.has(String(body.formatId))) throw new AppError('분석되지 않은 화질입니다.', 400, 'INVALID_FORMAT');
  const metadata = { ...body.metadata, sourceUrl: sourceUrl.href };
  const job = jobs.create(provider, metadata, { mode: body.mode, formatId: body.formatId });
  return json(res, 202, job);
}

async function sendDownload(res, job) {
  if (job.status !== 'ready') throw new AppError('파일이 아직 준비되지 않았습니다.', 409, 'FILE_NOT_READY');
  const stat = await fsp.stat(job.outputPath);
  res.writeHead(200, {
    'content-type': job.filename.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4',
    'content-length': stat.size,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(job.filename)}`,
    'cache-control': 'private, no-store'
  });
  fs.createReadStream(job.outputPath).pipe(res);
}

async function serveStatic(pathname, res) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const relative = path.normalize(requested).replace(/^([/\\])+/, '');
  const filePath = path.join(publicDir, relative);
  if (!filePath.startsWith(publicDir)) throw new AppError('잘못된 경로입니다.', 400, 'INVALID_PATH');
  let data;
  try { data = await fsp.readFile(filePath); } catch { throw new AppError('페이지를 찾을 수 없습니다.', 404, 'NOT_FOUND'); }
  const contentType = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' }[path.extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache' });
  res.end(data);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new AppError('요청이 너무 큽니다.', 413, 'PAYLOAD_TOO_LARGE');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new AppError('JSON 요청이 올바르지 않습니다.', 400, 'INVALID_JSON'); }
}

function json(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function setSecurityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('content-security-policy', "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'");
}

server.listen(config.port, config.host, () => {
  const address = server.address();
  console.log(`Company Media Downloader: http://${config.host}:${address.port}`);
  if (!auth.enabled) console.warn('APP_ACCESS_KEY가 없어 개발 모드에서 인증 없이 실행됩니다.');
});

export { server, jobs };
