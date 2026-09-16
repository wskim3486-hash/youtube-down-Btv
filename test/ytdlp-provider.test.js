import test from 'node:test';
import assert from 'node:assert/strict';
import { YtDlpProvider } from '../src/providers/ytdlp.js';

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
  assert.equal(spec.args[spec.args.indexOf('-f') + 1], '401+bestaudio/best');
  assert.equal(spec.args.includes('--merge-output-format'), true);
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
