import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMasterPlaylist } from '../src/providers/hls.js';

test('HLS master playlist에서 실제 variant를 높은 화질 순으로 반환한다', () => {
  const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080
https://cdn.example.com/high.m3u8`;
  const formats = parseMasterPlaylist(playlist, 'https://media.example.com/master.m3u8');
  assert.equal(formats.length, 2);
  assert.equal(formats[0].height, 1080);
  assert.equal(formats[1].id, 'https://media.example.com/low/index.m3u8');
});
