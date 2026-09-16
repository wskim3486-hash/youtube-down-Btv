import path from 'node:path';
import os from 'node:os';

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function portNumber(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : fallback;
}

export const config = Object.freeze({
  port: portNumber(process.env.PORT, 4173),
  host: process.env.HOST || '127.0.0.1',
  accessKey: process.env.APP_ACCESS_KEY || '',
  isProduction: process.env.NODE_ENV === 'production',
  ytdlpPath: process.env.YTDLP_PATH || 'yt-dlp',
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  maxConcurrent: positiveInt(process.env.MAX_CONCURRENT_DOWNLOADS, 2),
  downloadTtlMs: positiveInt(process.env.DOWNLOAD_TTL_MINUTES, 30) * 60_000,
  tempRoot: process.env.TEMP_ROOT
    ? path.resolve(process.env.TEMP_ROOT)
    : path.join(os.tmpdir(), 'company-media-downloader')
});
