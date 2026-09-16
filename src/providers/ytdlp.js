import { MediaProvider, normalizeTitle } from './base.js';
import { run } from '../lib/process.js';
import { AppError } from '../lib/errors.js';

const SOCIAL_HOSTS = /(^|\.)(youtube\.com|youtu\.be|instagram\.com)$/i;

export class YtDlpProvider extends MediaProvider {
  constructor(config) { super('ytdlp', 'YouTube / Instagram / 공개 영상'); this.config = config; }
  matches(url) { return SOCIAL_HOSTS.test(url.hostname); }

  async analyze(url) {
    const { stdout } = await run(this.config.ytdlpPath, [
      '--dump-single-json', '--no-playlist', '--no-warnings', '--no-call-home', '--', url.href
    ], { timeoutMs: 90_000 });
    let info;
    try { info = JSON.parse(stdout); } catch { throw new AppError('사이트의 영상 정보를 해석하지 못했습니다.', 422, 'INVALID_METADATA'); }
    if (info.is_live) throw new AppError('라이브 방송은 현재 지원하지 않습니다.', 422, 'LIVE_NOT_SUPPORTED');
    const formats = (info.formats || [])
      .filter(item => item.vcodec && item.vcodec !== 'none' && item.format_id)
      .map(item => ({
        id: String(item.format_id),
        label: formatLabel(item),
        height: item.height || null,
        ext: item.ext || 'mp4',
        filesize: item.filesize || item.filesize_approx || null
      }))
      .sort((a, b) => (b.height || 0) - (a.height || 0));
    const unique = [...new Map(formats.map(item => [`${item.height}-${item.ext}`, item])).values()];
    if (!unique.length) throw new AppError('다운로드 가능한 영상 화질을 찾지 못했습니다.', 422, 'NO_FORMATS');
    return {
      provider: this.id,
      title: normalizeTitle(info.title),
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      sourceUrl: url.href,
      formats: unique,
      audioAvailable: true
    };
  }

  buildDownload({ sourceUrl, formatId, mode, outputTemplate }) {
    const common = ['--no-playlist', '--no-call-home', '--no-part', '--newline'];
    if (mode === 'audio') {
      return { command: this.config.ytdlpPath, args: [...common, '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', outputTemplate, '--', sourceUrl], extension: 'mp3' };
    }
    if (!formatId) throw new AppError('화질을 선택하세요.', 400, 'FORMAT_REQUIRED');
    return {
      command: this.config.ytdlpPath,
      args: [...common, '-f', `${formatId}+bestaudio/best`, '--merge-output-format', 'mp4', '-o', outputTemplate, '--', sourceUrl],
      extension: 'mp4'
    };
  }
}

function formatLabel(item) {
  const quality = item.height ? `${item.height}p` : item.format_note || '영상';
  const fps = item.fps && item.fps > 30 ? ` · ${Math.round(item.fps)}fps` : '';
  const codec = item.vcodec ? ` · ${String(item.vcodec).split('.')[0]}` : '';
  return `${quality}${fps}${codec}`;
}
