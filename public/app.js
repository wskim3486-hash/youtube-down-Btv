const form = document.querySelector('#analyze-form');
const urlInput = document.querySelector('#media-url');
const analyzeButton = document.querySelector('#analyze-button');
const downloadButton = document.querySelector('#download-button');
const qualitySelect = document.querySelector('#quality-select');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const loginDialog = document.querySelector('#login-dialog');
const resetButton = document.querySelector('#reset-button');
let currentMedia = null;
let outputMode = 'video';
let downloadInProgress = false;

initialize();

async function initialize() {
  try {
    const health = await request('/api/health');
    if (health.authRequired && !window.clipPortDesktop?.isDesktop) loginDialog.showModal();
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

resetButton.addEventListener('click', () => {
  if (downloadInProgress) {
    window.alert('다운로드가 진행 중입니다. 완료된 뒤 새 영상을 시작해 주세요.');
    return;
  }
  resetApp();
});

downloadButton.addEventListener('click', async () => {
  if (!currentMedia || (outputMode === 'video' && !qualitySelect.value)) return;
  const requestedMode = outputMode;
  try {
    let desktopSavePath = null;
    if (window.clipPortDesktop?.isDesktop) {
      const extension = requestedMode === 'audio' ? 'mp3' : 'mp4';
      const selection = await window.clipPortDesktop.chooseSavePath({
        suggestedName: `${currentMedia.title}.${extension}`,
        extension
      });
      if (selection.canceled) {
        setDownloadState(false, '저장이 취소되었습니다.');
        return;
      }
      desktopSavePath = selection.filePath;
    }
    downloadInProgress = true;
    setInteractionLock(true);
    setDownloadState(true, `${requestedMode === 'audio' ? 'MP3' : 'MP4'} 파일을 준비하고 있습니다.`, false, requestedMode);
    const job = await request('/api/downloads', {
      method: 'POST',
      body: {
        metadata: currentMedia,
        mode: requestedMode,
        formatId: requestedMode === 'video' ? qualitySelect.value : null
      }
    });
    await waitForDownload(job.id, desktopSavePath, requestedMode);
  } catch (error) {
    setDownloadState(false, friendlyDownloadError(error.message, requestedMode), true, requestedMode);
  } finally {
    downloadInProgress = false;
    setInteractionLock(false);
  }
});

async function waitForDownload(jobId, desktopSavePath = null, requestedMode = outputMode) {
  for (;;) {
    await delay(250);
    const job = await request(`/api/downloads/${jobId}`);
    if (job.status === 'failed') throw new Error(job.error || '영상 다운로드에 실패했습니다.');
    if (job.status === 'ready') {
      const extension = requestedMode === 'audio' ? 'MP3' : 'MP4';
      if (window.clipPortDesktop?.isDesktop && desktopSavePath) {
        setDownloadState(true, `${extension} 준비 100% · 선택한 위치에 저장하고 있습니다.`, false, requestedMode);
        await window.clipPortDesktop.saveDownload({ jobId, filePath: desktopSavePath });
        setDownloadState(false, `${extension} 파일을 선택한 위치에 저장했습니다.`, false, requestedMode);
      } else {
        setDownloadState(false, `${extension} 파일이 준비되었습니다. 다운로드를 시작합니다.`, false, requestedMode);
        window.location.assign(`/api/downloads/${jobId}/file`);
      }
      return;
    }
    const progress = Number.isFinite(job.progress) ? ` ${job.progress}%` : '';
    setDownloadState(true, job.status === 'queued'
      ? '작업 순서를 기다리고 있습니다.'
      : requestedMode === 'audio'
        ? `오디오를 내려받고 MP3로 변환하고 있습니다.${progress}`
        : `영상을 다운로드하고 MP4 파일을 준비하고 있습니다.${progress}`);
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
  document.querySelector('#provider').textContent = media.site || media.provider || '';
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
    option.dataset.requiresFfmpeg = String(format.requiresFfmpeg);
    option.title = format.details || '';
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
    ? '영상과 호환성 높은 오디오를 병합해 MP4로 준비합니다.'
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

function setDownloadState(loading, message, isError = false, mode = outputMode) {
  downloadButton.disabled = loading;
  const extension = mode === 'audio' ? 'MP3' : 'MP4';
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

function friendlyDownloadError(message, mode = outputMode) {
  if (/ffmpeg/i.test(message)) {
    return mode === 'audio'
      ? 'MP3 추출에 필요한 FFmpeg를 사용할 수 없습니다.'
      : '영상과 음성을 병합하지 못했습니다. 앱을 다시 실행한 뒤 시도해 주세요.';
  }
  if (/unavailable|not available/i.test(message)) return '현재 이 영상을 다운로드할 수 없습니다. 공개 상태인지 확인하세요.';
  return message || `${mode === 'audio' ? 'MP3' : 'MP4'} 파일을 준비하지 못했습니다.`;
}

function setInteractionLock(locked) {
  qualitySelect.disabled = locked;
  document.querySelectorAll('[data-mode]').forEach(button => { button.disabled = locked; });
}

function resetApp() {
  currentMedia = null;
  form.reset();
  setOutputMode('video');
  result.classList.add('hidden');
  status.classList.add('hidden');
  status.classList.remove('error');
  document.querySelector('#status-title').textContent = '';
  document.querySelector('#status-message').textContent = '';
  document.querySelector('#thumbnail').removeAttribute('src');
  document.querySelector('#thumbnail-wrap').classList.add('hidden');
  document.querySelector('#provider').textContent = '';
  document.querySelector('#title').textContent = '';
  document.querySelector('#duration').textContent = '';
  document.querySelector('#format-count').textContent = '';
  document.querySelector('#format-help').textContent = '';
  document.querySelector('#download-status').textContent = '';
  document.querySelector('#download-status').classList.remove('error');
  qualitySelect.replaceChildren();
  qualitySelect.disabled = false;
  downloadButton.disabled = true;
  urlInput.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.round(seconds % 60);
  return [hours, minutes, rest].filter((_, index) => hours > 0 || index > 0).map(value => String(value).padStart(2, '0')).join(':');
}

function formatBytes(bytes) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
