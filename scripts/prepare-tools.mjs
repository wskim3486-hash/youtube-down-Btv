import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const YTDLP_VERSION = '2026.08.19';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const platformKey = `${process.platform}-${process.arch}`;
const destination = path.join(root, 'resources', 'tools', platformKey);

if (!['win32', 'darwin'].includes(process.platform)) {
  throw new Error(`지원하지 않는 도구 준비 플랫폼입니다: ${process.platform}`);
}

await fs.mkdir(destination, { recursive: true });

const ytDlpAsset = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp_macos';
const ytDlpName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const releaseBase = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}`;
const [binary, sums] = await Promise.all([
  download(`${releaseBase}/${ytDlpAsset}`),
  download(`${releaseBase}/SHA2-256SUMS`)
]);
const expected = findChecksum(sums.toString('utf8'), ytDlpAsset);
const actual = crypto.createHash('sha256').update(binary).digest('hex');
if (actual !== expected) throw new Error(`yt-dlp 체크섬이 일치하지 않습니다: ${actual}`);

await fs.writeFile(path.join(destination, ytDlpName), binary, { mode: 0o755 });
await copyExecutable(ffmpegPath, path.join(destination, executableName('ffmpeg')));
await copyExecutable(ffprobeStatic.path, path.join(destination, executableName('ffprobe')));

console.log(`도구 준비 완료: ${destination}`);
console.log(`yt-dlp ${YTDLP_VERSION} (${actual})`);

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`도구 다운로드 실패 (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function findChecksum(content, filename) {
  const line = content.split(/\r?\n/).find(item => item.trim().endsWith(filename));
  const checksum = line?.trim().split(/\s+/)[0]?.toLowerCase();
  if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) {
    throw new Error(`SHA2-256SUMS에서 ${filename} 체크섬을 찾지 못했습니다.`);
  }
  return checksum;
}

async function copyExecutable(source, target) {
  if (!source) throw new Error(`실행파일 경로가 없습니다: ${target}`);
  await fs.copyFile(source, target);
  if (process.platform !== 'win32') await fs.chmod(target, 0o755);
}

function executableName(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}
