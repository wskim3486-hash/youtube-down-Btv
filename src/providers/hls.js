import { MediaProvider, normalizeTitle } from './base.js';
import { safeFetch } from '../lib/network.js';
import { AppError } from '../lib/errors.js';

const M3U8_PATTERN = /https?:[^"'\s\\]+\.m3u8(?:\?[^"'\s\\<]*)?/gi;
const ASSEMBLY_HOST = /(^|\.)(assembly\.go\.kr|assembly\.webcast\.go\.kr)$/i;

export class HlsProvider extends MediaProvider {
  constructor(config) { super('hls', '공공기관 HLS'); this.config = config; }
  matches(url) { return url.pathname.toLowerCase().includes('.m3u8') || ASSEMBLY_HOST.test(url.hostname); }

  async analyze(pageUrl) {
    let manifestUrl = pageUrl.href;
    let title = 'public-video';
    if (!pageUrl.pathname.toLowerCase().includes('.m3u8')) {
      const response = await safeFetch(pageUrl.href, { headers: { 'user-agent': 'CompanyMediaDownloader/1.0' } });
      if (!response.ok) throw new AppError('영상 페이지를 불러오지 못했습니다.', 422, 'PAGE_FETCH_FAILED');
      const html = await response.text();
      title = normalizeTitle(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]);
      const escaped = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
      const candidate = escaped.match(M3U8_PATTERN)?.[0];
      if (!candidate) throw new AppError('페이지에서 공개 HLS 재생목록을 찾지 못했습니다.', 422, 'HLS_NOT_FOUND');
      manifestUrl = candidate.replace(/&amp;/g, '&');
    }
    const response = await safeFetch(manifestUrl, { headers: { referer: pageUrl.href } });
    if (!response.ok) throw new AppError('HLS 재생목록을 불러오지 못했습니다.', 422, 'HLS_FETCH_FAILED');
    const manifest = await response.text();
    const formats = parseMasterPlaylist(manifest, manifestUrl);
    return {
      provider: this.id,
      title,
      thumbnail: null,
      duration: null,
      sourceUrl: pageUrl.href,
      manifestUrl,
      formats: formats.length ? formats : [{ id: manifestUrl, label: '원본 스트림', height: null, ext: 'mp4' }],
      audioAvailable: true
    };
  }

  buildDownload({ manifestUrl, formatId, mode, outputPath }) {
    const input = formatId || manifestUrl;
    if (!input) throw new AppError('HLS 스트림 주소가 없습니다.', 400, 'FORMAT_REQUIRED');
    if (mode === 'audio') return { command: this.config.ffmpegPath, args: ['-nostdin', '-y', '-i', input, '-vn', '-codec:a', 'libmp3lame', '-q:a', '0', outputPath], extension: 'mp3' };
    return { command: this.config.ffmpegPath, args: ['-nostdin', '-y', '-i', input, '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', outputPath], extension: 'mp4' };
  }
}

export function parseMasterPlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const formats = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = lines[i];
    const next = lines.slice(i + 1).find(line => line && !line.startsWith('#'));
    if (!next) continue;
    const resolution = attrs.match(/RESOLUTION=(\d+)x(\d+)/i);
    const bandwidth = Number(attrs.match(/BANDWIDTH=(\d+)/i)?.[1] || 0);
    const height = resolution ? Number(resolution[2]) : null;
    const id = new URL(next, baseUrl).href;
    formats.push({ id, label: height ? `${height}p · HLS` : `${Math.round(bandwidth / 1000)}kbps · HLS`, height, ext: 'mp4', bitrate: bandwidth });
  }
  return formats.sort((a, b) => (b.height || b.bitrate) - (a.height || a.bitrate));
}
