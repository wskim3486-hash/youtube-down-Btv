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
