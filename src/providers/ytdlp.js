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
    const formats = selectPreferredFormats(info.formats || []);
    if (!formats.length) throw new AppError('다운로드 가능한 영상 화질을 찾지 못했습니다.', 422, 'NO_FORMATS');
    return {
      provider: this.id,
      title: normalizeTitle(info.title),
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      sourceUrl: url.href,
      formats,
      audioAvailable: true
    };
  }

  buildDownload({ sourceUrl, formatId, mode, outputTemplate, formats = [] }) {
    const common = [
      '--no-playlist', '--no-call-home', '--no-part', '--newline',
      '--progress-template', 'download:PROGRESS:%(progress._percent_str)s'
    ];
    if (mode === 'audio') {
      const ffmpegLocation = this.config.ffmpegPath !== 'ffmpeg'
        ? ['--ffmpeg-location', this.config.ffmpegPath]
        : [];
      return {
        command: this.config.ytdlpPath,
        args: [...common, ...ffmpegLocation, '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', outputTemplate, '--', sourceUrl],
        extension: 'mp3',
        preflight: { command: this.config.ffmpegPath, args: ['-version'] }
      };
    }
    if (!formatId) throw new AppError('화질을 선택하세요.', 400, 'FORMAT_REQUIRED');
    const selected = formats.find(item => String(item.id) === String(formatId));
    if (!selected) throw new AppError('선택한 화질 정보를 찾을 수 없습니다.', 400, 'FORMAT_NOT_FOUND');
    const needsMerge = !selected.hasAudio || selected.ext !== 'mp4';
    const selection = selected.hasAudio
      ? String(formatId)
      : [
        `${formatId}+bestaudio[ext=m4a]`,
        `${formatId}+bestaudio[acodec^=mp4a]`,
        `${formatId}+bestaudio`
      ].join('/');
    const ffmpegLocation = needsMerge && this.config.ffmpegPath !== 'ffmpeg'
      ? ['--ffmpeg-location', this.config.ffmpegPath]
      : [];
    const conversion = needsMerge ? [...ffmpegLocation, '--merge-output-format', 'mp4'] : [];
    return {
      command: this.config.ytdlpPath,
      args: [...common, '-f', selection, ...conversion, '-o', outputTemplate, '--', sourceUrl],
      extension: 'mp4',
      preflight: needsMerge ? { command: this.config.ffmpegPath, args: ['-version'] } : null
    };
  }
}

export function selectPreferredFormats(sourceFormats) {
  const candidates = sourceFormats
    .filter(item => item.vcodec && item.vcodec !== 'none' && item.format_id && item.height)
    .map(item => {
      const hasAudio = Boolean(item.acodec && item.acodec !== 'none');
      const codec = codecFamily(item.vcodec);
      return {
        id: String(item.format_id),
        label: `${item.height}p`,
        details: `${codec.label} · ${String(item.ext || 'mp4').toUpperCase()}${hasAudio ? ' · 영상+음성' : ' · 영상 전용'}`,
        height: item.height,
        ext: item.ext || 'mp4',
        filesize: item.filesize || item.filesize_approx || null,
        hasAudio,
        vcodec: item.vcodec,
        codec: codec.id,
        fps: item.fps || null,
        bitrate: item.tbr || item.vbr || 0,
        requiresFfmpeg: !hasAudio || item.ext !== 'mp4'
      };
    });

  const byHeight = new Map();
  for (const format of candidates) {
    const current = byHeight.get(format.height);
    if (!current || compareCompatibility(format, current) < 0) byHeight.set(format.height, format);
  }
  return [...byHeight.values()].sort((a, b) => b.height - a.height);
}

function compareCompatibility(left, right) {
  return codecRank(left.codec) - codecRank(right.codec)
    || Number(right.ext === 'mp4') - Number(left.ext === 'mp4')
    || Number(right.hasAudio) - Number(left.hasAudio)
    || (right.bitrate || 0) - (left.bitrate || 0);
}

function codecFamily(value) {
  const codec = String(value).toLowerCase();
  if (/^(avc1|avc3|h264)/.test(codec)) return { id: 'h264', label: 'H.264' };
  if (/^(vp0?9)/.test(codec)) return { id: 'vp9', label: 'VP9' };
  if (/^(av01|av1)/.test(codec)) return { id: 'av1', label: 'AV1' };
  return { id: 'other', label: String(value).split('.')[0].toUpperCase() };
}

function codecRank(codec) {
  return { h264: 0, vp9: 1, av1: 2, other: 3 }[codec] ?? 4;
}
