import test from 'node:test';
import assert from 'node:assert/strict';
import { YtDlpProvider, selectPreferredFormats, siteName } from '../src/providers/ytdlp.js';

const provider = new YtDlpProvider({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' });

test('영상과 음성이 포함된 MP4는 FFmpeg 없이 원본 포맷을 선택한다', () => {
  const spec = provider.buildDownload({
    sourceUrl: 'https://www.youtube.com/watch?v=example',
    formatId: '18',
    mode: 'video',
    outputTemplate: 'video.%(ext)s',
    formats: [{ id: '18', ext: 'mp4', hasAudio: true }]
  });
  assert.equal(spec.args.includes('--ffmpeg-location'), false);
  assert.equal(spec.args[spec.args.indexOf('-f') + 1], '18');
  assert.equal(spec.args[spec.args.indexOf('--progress-template') + 1], 'download:PROGRESS:%(progress._percent_str)s');
});

test('영상 전용 포맷은 최고 오디오와 FFmpeg 병합을 요청한다', () => {
  const spec = provider.buildDownload({
    sourceUrl: 'https://www.youtube.com/watch?v=example',
    formatId: '401',
    mode: 'video',
    outputTemplate: 'video.%(ext)s',
    formats: [{ id: '401', ext: 'mp4', hasAudio: false }]
  });
  assert.deepEqual(spec.preflight, { command: 'ffmpeg', args: ['-version'] });
  assert.equal(
    spec.args[spec.args.indexOf('-f') + 1],
    '401+bestaudio[ext=m4a]/401+bestaudio[acodec^=mp4a]/401+bestaudio'
  );
  assert.equal(spec.args.includes('--merge-output-format'), true);
});

test('같은 해상도는 편집 호환성이 높은 H.264 포맷 하나를 선택한다', () => {
  const formats = selectPreferredFormats([
    { format_id: '399', height: 1080, ext: 'mp4', vcodec: 'av01.0.08M.08', acodec: 'none', tbr: 1200 },
    { format_id: '303', height: 1080, ext: 'webm', vcodec: 'vp9', acodec: 'none', tbr: 1500 },
    { format_id: '137', height: 1080, ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', tbr: 1000 },
    { format_id: '22', height: 720, ext: 'mp4', vcodec: 'avc1.64001F', acodec: 'mp4a.40.2', tbr: 900 }
  ]);
  assert.deepEqual(formats.map(format => [format.label, format.id, format.codec]), [
    ['1080p', '137', 'h264'],
    ['720p', '22', 'h264']
  ]);
});

test('MP3 추출은 FFmpeg 사전검사와 최고 품질 VBR 변환을 요청한다', () => {
  const spec = provider.buildDownload({
    sourceUrl: 'https://www.youtube.com/watch?v=example',
    mode: 'audio',
    outputTemplate: 'safe-title.%(ext)s'
  });
  assert.equal(spec.extension, 'mp3');
  assert.deepEqual(spec.preflight, { command: 'ffmpeg', args: ['-version'] });
  assert.equal(spec.args.includes('-x'), true);
  assert.equal(spec.args.includes('--progress-template'), true);
  assert.equal(spec.args[spec.args.indexOf('--audio-format') + 1], 'mp3');
  assert.equal(spec.args[spec.args.indexOf('--audio-quality') + 1], '0');
});

test('Instagram VP9와 HE-AAC는 H.264와 AAC-LC로 변환한다', () => {
  const spec = provider.buildDownload({
    sourceUrl: 'https://www.instagram.com/reel/example/',
    formatId: 'dash-vp9',
    mode: 'video',
    outputPath: 'video.mp4',
    outputTemplate: 'video.%(ext)s',
    formats: [{
      id: 'dash-vp9', ext: 'mp4', hasAudio: true, codec: 'vp9',
      acodec: 'mp4a.40.5', audioCompatible: false
    }]
  });
  assert.equal(spec.args[spec.args.indexOf('-f') + 1], 'dash-vp9');
  assert.equal(spec.args.includes('video.source.%(ext)s'), true);
  const postprocess = spec.postprocess('video.source.mp4');
  assert.equal(postprocess.args[postprocess.args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(postprocess.args[postprocess.args.indexOf('-c:a') + 1], 'aac');
  assert.deepEqual(spec.expectedMedia, { videoCodec: 'h264', audioCodec: 'aac', audioProfile: 'LC' });
});

test('Instagram H.264와 AAC-LC MP4는 재인코딩하지 않는다', () => {
  const spec = provider.buildDownload({
    sourceUrl: 'https://www.instagram.com/reel/example/',
    formatId: 'compatible',
    mode: 'video',
    outputPath: 'video.mp4',
    outputTemplate: 'video.%(ext)s',
    formats: [{
      id: 'compatible', ext: 'mp4', hasAudio: true, codec: 'h264',
      acodec: 'mp4a.40.2', audioCompatible: true
    }]
  });
  assert.equal(spec.postprocess, undefined);
  assert.equal(spec.args[spec.args.indexOf('-f') + 1], 'compatible');
});

test('Instagram H.264와 HE-AAC는 영상은 복사하고 오디오만 AAC-LC로 변환한다', () => {
  const spec = provider.buildDownload({
    sourceUrl: 'https://www.instagram.com/reel/example/',
    formatId: 'h264-he-aac',
    mode: 'video',
    outputPath: 'video.mp4',
    outputTemplate: 'video.%(ext)s',
    formats: [{
      id: 'h264-he-aac', ext: 'mp4', hasAudio: true, codec: 'h264',
      acodec: 'mp4a.40.5', audioCompatible: false
    }]
  });
  const postprocess = spec.postprocess('video.source.mp4');
  assert.equal(postprocess.args[postprocess.args.indexOf('-c:v') + 1], 'copy');
  assert.equal(postprocess.args[postprocess.args.indexOf('-c:a') + 1], 'aac');
});

test('Instagram VP9와 AAC-LC는 오디오는 복사하고 영상만 H.264로 변환한다', () => {
  const spec = provider.buildDownload({
    sourceUrl: 'https://www.instagram.com/reel/example/',
    formatId: 'vp9-aac-lc',
    mode: 'video',
    outputPath: 'video.mp4',
    outputTemplate: 'video.%(ext)s',
    formats: [{
      id: 'vp9-aac-lc', ext: 'mp4', hasAudio: true, codec: 'vp9',
      acodec: 'mp4a.40.2', audioCompatible: true
    }]
  });
  const postprocess = spec.postprocess('video.source.mp4');
  assert.equal(postprocess.args[postprocess.args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(postprocess.args[postprocess.args.indexOf('-c:a') + 1], 'copy');
});

test('분석 출처 이름은 실제 URL과 extractor에서 결정한다', () => {
  assert.equal(siteName({ extractor_key: 'Youtube' }, new URL('https://youtu.be/example')), 'YouTube');
  assert.equal(siteName({ extractor_key: 'Instagram' }, new URL('https://www.instagram.com/reel/example/')), 'Instagram');
});
