import { MediaProvider, normalizeTitle } from './base.js';
import { run } from '../lib/process.js';
import { AppError } from '../lib/errors.js';

const SOCIAL_HOSTS = /(^|\.)(youtube\.com|youtu\.be|instagram\.com)$/i;
const INSTAGRAM_HOSTS = /(^|\.)instagram\.com$/i;

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
      site: siteName(info, url),
      title: normalizeTitle(info.title),
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      sourceUrl: url.href,
      formats,
      audioAvailable: true
    };
  }

  buildDownload({ sourceUrl, formatId, mode, outputPath, outputTemplate, formats = [] }) {
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
    if (isInstagramUrl(sourceUrl)) {
      return buildInstagramDownload({
        common,
        selected,
        sourceUrl,
        outputPath,
        outputTemplate,
        ytdlpPath: this.config.ytdlpPath,
        ffmpegPath: this.config.ffmpegPath
      });
    }
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
  const preferredAudio = selectPreferredAudio(sourceFormats);
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
        acodec: hasAudio ? item.acodec : preferredAudio?.acodec || null,
        audioFormatId: hasAudio ? null : preferredAudio?.id || null,
        audioCompatible: hasAudio ? isAacLc(item.acodec) : Boolean(preferredAudio?.compatible),
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

export function siteName(info, url) {
  const extractor = String(info?.extractor_key || info?.extractor || '').toLowerCase();
  if (extractor.includes('instagram') || INSTAGRAM_HOSTS.test(url.hostname)) return 'Instagram';
  if (extractor.includes('youtube') || /(^|\.)(youtube\.com|youtu\.be)$/i.test(url.hostname)) return 'YouTube';
  return info?.extractor_key || info?.extractor || url.hostname;
}

function buildInstagramDownload({ common, selected, sourceUrl, outputPath, outputTemplate, ytdlpPath, ffmpegPath }) {
  const needsMerge = !selected.hasAudio || selected.ext !== 'mp4';
  const needsVideoTranscode = selected.codec !== 'h264';
  const needsAudioTranscode = !selected.audioCompatible;
  const needsCompatibilityTranscode = needsVideoTranscode || needsAudioTranscode;
  const selection = selected.hasAudio
    ? String(selected.id)
    : selected.audioFormatId
      ? `${selected.id}+${selected.audioFormatId}`
      : [
        `${selected.id}+bestaudio[acodec=mp4a.40.2]`,
        `${selected.id}+bestaudio[ext=m4a]`,
        `${selected.id}+bestaudio`
      ].join('/');
  const needsFfmpeg = needsMerge || needsCompatibilityTranscode;
  const ffmpegLocation = needsFfmpeg && ffmpegPath !== 'ffmpeg'
    ? ['--ffmpeg-location', ffmpegPath]
    : [];
  const conversion = needsMerge ? ['--merge-output-format', 'mp4'] : [];

  if (!needsCompatibilityTranscode) {
    return {
      command: ytdlpPath,
      args: [...common, '-f', selection, ...ffmpegLocation, ...conversion, '-o', outputTemplate, '--', sourceUrl],
      extension: 'mp4',
      preflight: needsFfmpeg ? { command: ffmpegPath, args: ['-version'] } : null,
      expectedMedia: instagramExpectedMedia()
    };
  }

  const intermediateTemplate = outputTemplate.replace(/\.%\(ext\)s$/, '.source.%(ext)s');
  return {
    command: ytdlpPath,
    args: [...common, '-f', selection, ...ffmpegLocation, ...conversion, '-o', intermediateTemplate, '--', sourceUrl],
    extension: 'mp4',
    intermediateMarker: '.source.',
    preflight: { command: ffmpegPath, args: ['-version'] },
    postprocess: inputPath => ({
      command: ffmpegPath,
      args: [
        '-nostdin', '-y', '-i', inputPath,
        '-map', '0:v:0', '-map', '0:a:0',
        ...(needsVideoTranscode
          ? ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '18', '-tag:v', 'avc1']
          : ['-c:v', 'copy']),
        ...(needsAudioTranscode
          ? ['-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '192k']
          : ['-c:a', 'copy']),
        '-movflags', '+faststart', outputPath
      ]
    }),
    expectedMedia: instagramExpectedMedia()
  };
}

function selectPreferredAudio(sourceFormats) {
  return sourceFormats
    .filter(item => (!item.vcodec || item.vcodec === 'none') && item.acodec && item.acodec !== 'none' && item.format_id)
    .map(item => ({
      id: String(item.format_id),
      acodec: item.acodec,
      compatible: isAacLc(item.acodec),
      rank: isAacLc(item.acodec) ? 0 : isAac(item.acodec) ? 1 : 2,
      bitrate: item.abr || item.tbr || 0
    }))
    .sort((left, right) => left.rank - right.rank || right.bitrate - left.bitrate)[0] || null;
}

function isInstagramUrl(value) {
  try { return INSTAGRAM_HOSTS.test(new URL(value).hostname); }
  catch { return false; }
}

function isAac(value) {
  return /^(aac|mp4a)/i.test(String(value || ''));
}

function isAacLc(value) {
  return /^(aac|mp4a\.40\.2)(?:$|\.)/i.test(String(value || ''));
}

function instagramExpectedMedia() {
  return { videoCodec: 'h264', audioCodec: 'aac', audioProfile: 'LC' };
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
