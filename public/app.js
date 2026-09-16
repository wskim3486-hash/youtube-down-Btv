const form = document.querySelector('#analyze-form');
const urlInput = document.querySelector('#media-url');
const analyzeButton = document.querySelector('#analyze-button');
const downloadButton = document.querySelector('#download-button');
const qualitySelect = document.querySelector('#quality-select');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const loginDialog = document.querySelector('#login-dialog');
let currentMedia = null;
let outputMode = 'video';

initialize();

async function initialize() {
  try {
    const health = await request('/api/health');
    if (health.authRequired) loginDialog.showModal();
  } catch (error) {
    showError(error.message);
  }
}

document.querySelector('#paste-button').addEventListener('click', async () => {
  try { urlInput.value = await navigator.clipboard.readText(); }
  catch { urlInput.focus(); }
});

document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorElement = document.querySelector('#login-error');
  errorElement.textContent = '';
  try {
    await request('/api/login', { method: 'POST', body: { accessKey: document.querySelector('#access-key').value } });
    loginDialog.close();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;
  currentMedia = null;
  setAnalyzing(true);
  result.classList.add('hidden');
  showStatus('영상 정보를 분석하고 있습니다', '사이트에서 실제 제공하는 화질을 확인합니다.');
  try {
    currentMedia = await request('/api/analyze', { method: 'POST', body: { url } });
    renderResult(currentMedia);
  } catch (error) {
    showError(error.message);
  } finally {
    setAnalyzing(false);
  }
});

qualitySelect.addEventListener('change', updateFormatHelp);

document.querySelectorAll('[data-mode]').forEach(button => {
  button.addEventListener('click', () => setOutputMode(button.dataset.mode));
});

downloadButton.addEventListener('click', async () => {
  if (!currentMedia || (outputMode === 'video' && !qualitySelect.value)) return;
  setDownloadState(true, `${outputMode === 'audio' ? 'MP3' : 'MP4'} 파일을 준비하고 있습니다.`);
  try {
    const job = await request('/api/downloads', {
      method: 'POST',
      body: {
        metadata: currentMedia,
        mode: outputMode,
        formatId: outputMode === 'video' ? qualitySelect.value : null
      }
    });
    await waitForDownload(job.id);
  } catch (error) {
    setDownloadState(false, friendlyDownloadError(error.message), true);
  }
});

async function waitForDownload(jobId) {
  for (;;) {
    await delay(1000);
    const job = await request(`/api/downloads/${jobId}`);
    if (job.status === 'failed') throw new Error(job.error || '영상 다운로드에 실패했습니다.');
    if (job.status === 'ready') {
      const extension = outputMode === 'audio' ? 'MP3' : 'MP4';
      setDownloadState(false, `${extension} 파일이 준비되었습니다. 다운로드를 시작합니다.`);
      window.location.assign(`/api/downloads/${jobId}/file`);
      return;
    }
    setDownloadState(true, job.status === 'queued'
      ? '작업 순서를 기다리고 있습니다.'
      : outputMode === 'audio' ? '오디오를 추출하고 MP3로 변환하고 있습니다.' : '영상을 다운로드하고 MP4 파일을 준비하고 있습니다.');
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '요청을 처리하지 못했습니다.');
  return data;
}

function renderResult(media) {
  status.classList.add('hidden');
  result.classList.remove('hidden');
  document.querySelector('#provider').textContent = 'YouTube';
  document.querySelector('#title').textContent = media.title || '제목 없음';
  document.querySelector('#duration').textContent = media.duration ? formatDuration(media.duration) : '영상 길이 정보 없음';
  const thumbnailWrap = document.querySelector('#thumbnail-wrap');
  if (media.thumbnail) {
    document.querySelector('#thumbnail').src = media.thumbnail;
    thumbnailWrap.classList.remove('hidden');
  } else {
    thumbnailWrap.classList.add('hidden');
  }
  qualitySelect.replaceChildren(...media.formats.map(format => {
    const option = document.createElement('option');
    option.value = format.id;
    option.textContent = `${format.label}${format.filesize ? ` · ${formatBytes(format.filesize)}` : ''}`;
    return option;
  }));
  document.querySelector('#format-count').textContent = `${media.formats.length}개`;
  downloadButton.disabled = media.formats.length === 0;
  document.querySelector('#download-status').textContent = '';
  setOutputMode(outputMode);
  result.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateFormatHelp() {
  if (outputMode === 'audio') {
    document.querySelector('#format-help').textContent = '영상의 오디오를 일반적으로 호환되는 MP3 파일로 추출합니다.';
    return;
  }
  const selected = currentMedia?.formats.find(format => String(format.id) === qualitySelect.value);
  document.querySelector('#format-help').textContent = selected?.requiresFfmpeg
    ? '이 화질은 영상과 음성 병합을 위해 서버에 FFmpeg가 필요합니다.'
    : '영상과 음성이 포함된 MP4 원본을 그대로 다운로드합니다.';
}

function setOutputMode(mode) {
  outputMode = mode === 'audio' ? 'audio' : 'video';
  document.querySelectorAll('[data-mode]').forEach(button => {
    const active = button.dataset.mode === outputMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  const audio = outputMode === 'audio';
  document.querySelector('.format-heading').classList.toggle('hidden', audio);
  qualitySelect.classList.toggle('hidden', audio);
  downloadButton.textContent = audio ? 'MP3 다운로드' : 'MP4 다운로드';
  updateFormatHelp();
}

function setAnalyzing(loading) {
  analyzeButton.disabled = loading;
  analyzeButton.firstElementChild.textContent = loading ? '분석 중' : '영상 분석';
}

function setDownloadState(loading, message, isError = false) {
  downloadButton.disabled = loading;
  const extension = outputMode === 'audio' ? 'MP3' : 'MP4';
  downloadButton.textContent = loading ? `${extension} 준비 중…` : `${extension} 다운로드`;
  const element = document.querySelector('#download-status');
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function showStatus(title, message) {
  status.classList.remove('hidden', 'error');
  document.querySelector('#status-title').textContent = title;
  document.querySelector('#status-message').textContent = message;
}

function showError(message) {
  result.classList.add('hidden');
  status.classList.remove('hidden');
  status.classList.add('error');
  document.querySelector('#status-title').textContent = '분석하지 못했습니다';
  document.querySelector('#status-message').textContent = message;
}

function friendlyDownloadError(message) {
  if (/ffmpeg/i.test(message)) {
    return outputMode === 'audio'
      ? 'MP3 추출에 필요한 서버 FFmpeg를 사용할 수 없습니다. 관리자에게 문의하세요.'
      : '선택한 화질은 영상과 음성 병합이 필요합니다. 서버 FFmpeg 상태를 확인하세요.';
  }
  if (/unavailable|not available/i.test(message)) return '현재 이 영상을 다운로드할 수 없습니다. 공개 상태인지 확인하세요.';
  return message || `${outputMode === 'audio' ? 'MP3' : 'MP4'} 파일을 준비하지 못했습니다.`;
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.round(seconds % 60);
  return [hours, minutes, rest].filter((_, index) => hours > 0 || index > 0).map(value => String(value).padStart(2, '0')).join(':');
}

function formatBytes(bytes) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
