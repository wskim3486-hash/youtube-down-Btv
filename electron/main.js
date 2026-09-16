import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { createAuth } from '../src/auth.js';

const { app, BrowserWindow, dialog, ipcMain } = electron;
app.setName('Btv ClipPort');

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const approvedSavePaths = new Set();
let mainWindow;
let localServer;
let jobs;
let appOrigin;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(startDesktopApp).catch(error => {
  dialog.showErrorBox('Btv ClipPort 시작 오류', error.message || String(error));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => localServer?.close());

async function startDesktopApp() {
  const toolPaths = resolveToolPaths();
  verifyTool('yt-dlp', toolPaths.ytdlp, '--version');
  verifyTool('FFmpeg', toolPaths.ffmpeg, '-version');
  verifyTool('ffprobe', toolPaths.ffprobe, '-version');

  const accessKey = crypto.randomBytes(32).toString('hex');
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';
  process.env.NODE_ENV = 'production';
  process.env.APP_ACCESS_KEY = accessKey;
  process.env.YTDLP_PATH = toolPaths.ytdlp;
  process.env.FFMPEG_PATH = toolPaths.ffmpeg;
  process.env.FFPROBE_PATH = toolPaths.ffprobe;
  process.env.TEMP_ROOT = path.join(app.getPath('temp'), 'clipport', 'jobs');

  const serverModule = await import('../src/server.js');
  localServer = serverModule.server;
  jobs = serverModule.jobs;
  await waitUntilListening(localServer);
  const address = localServer.address();
  appOrigin = `http://127.0.0.1:${address.port}`;

  registerDesktopIpc();
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 640,
    show: !isSmokeTest(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(projectRoot, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const auth = createAuth(accessKey);
  const sessionValue = auth.cookie().match(/^media_session=([^;]+)/)?.[1];
  await mainWindow.webContents.session.cookies.set({
    url: appOrigin,
    name: 'media_session',
    value: sessionValue,
    httpOnly: true,
    sameSite: 'strict'
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appOrigin)) event.preventDefault();
  });
  await mainWindow.loadURL(appOrigin);
  if (isSmokeTest()) await runSmokeTest();
}

function registerDesktopIpc() {
  ipcMain.handle('desktop:choose-save-path', async (event, options = {}) => {
    assertTrustedSender(event);
    const extension = options.extension === 'mp3' ? 'mp3' : 'mp4';
    const suggestedName = safeFilename(options.suggestedName, extension);
    const smokeDirectory = isSmokeTest() && process.env.CLIPPORT_TEST_OUTPUT_DIR;
    const result = smokeDirectory
      ? { canceled: false, filePath: path.join(smokeDirectory, suggestedName) }
      : await dialog.showSaveDialog(mainWindow, {
        title: `${extension.toUpperCase()} 저장 위치 선택`,
        defaultPath: path.join(app.getPath('downloads'), suggestedName),
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
      });
    if (result.canceled || !result.filePath) return { canceled: true };
    const destination = path.resolve(result.filePath);
    approvedSavePaths.add(destination);
    return { canceled: false, filePath: destination };
  });

  ipcMain.handle('desktop:save-download', async (event, options = {}) => {
    assertTrustedSender(event);
    const destination = path.resolve(String(options.filePath || ''));
    if (!approvedSavePaths.delete(destination)) throw new Error('승인되지 않은 저장 경로입니다.');
    const job = jobs.get(String(options.jobId || ''));
    if (job.status !== 'ready') throw new Error('파일이 아직 준비되지 않았습니다.');
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(job.outputPath, destination, fs.constants.COPYFILE_FICLONE);
    await jobs.remove(job.id);
    return { saved: true, filePath: destination };
  });
}

function resolveToolPaths() {
  const platformDirectory = `${process.platform}-${process.arch}`;
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'tools', platformDirectory)
    : path.join(projectRoot, 'resources', 'tools', platformDirectory);
  const extension = process.platform === 'win32' ? '.exe' : '';
  return {
    ytdlp: path.join(base, `yt-dlp${extension}`),
    ffmpeg: path.join(base, `ffmpeg${extension}`),
    ffprobe: path.join(base, `ffprobe${extension}`)
  };
}

function verifyTool(name, executable, versionFlag) {
  if (!fs.existsSync(executable)) throw new Error(`${name} 실행파일을 찾을 수 없습니다: ${executable}`);
  const result = spawnSync(executable, [versionFlag], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${name} 실행 점검에 실패했습니다: ${executable}`);
  console.log(`[desktop] ${name}: ${String(result.stdout || result.stderr).split(/\r?\n/)[0]}`);
}

function waitUntilListening(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

function assertTrustedSender(event) {
  if (!event.senderFrame.url.startsWith(appOrigin)) throw new Error('허용되지 않은 IPC 요청입니다.');
}

function safeFilename(value, extension) {
  const base = path.basename(String(value || `Btv ClipPort.${extension}`))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180);
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
}

function isSmokeTest() {
  const packagedTestAllowed = !app.isPackaged || process.env.CLIPPORT_ALLOW_PACKAGED_SMOKE === '1';
  return packagedTestAllowed && process.argv.includes('--smoke-test');
}

async function runSmokeTest() {
  const outputDirectory = process.env.CLIPPORT_TEST_OUTPUT_DIR;
  const reportPath = process.env.CLIPPORT_TEST_REPORT;
  if (!outputDirectory || !reportPath) throw new Error('스모크 테스트 출력 경로가 필요합니다.');
  await fsp.mkdir(outputDirectory, { recursive: true });
  const result = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const waitFor = async (predicate, timeout = 180000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const value = await predicate();
          if (value) return value;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        throw new Error('UI smoke test timeout');
      };
      document.querySelector('#media-url').value = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
      document.querySelector('#analyze-form').requestSubmit();
      await waitFor(() => !document.querySelector('#result').classList.contains('hidden'));
      const qualityLabels = [...document.querySelector('#quality-select').options].map(option => option.textContent.split(' · ')[0]);
      const analyzed = {
        title: document.querySelector('#title').textContent,
        duration: document.querySelector('#duration').textContent,
        formats: document.querySelector('#quality-select').options.length,
        thumbnail: Boolean(document.querySelector('#thumbnail').src),
        uniqueResolutions: new Set(qualityLabels).size === qualityLabels.length,
        brand: document.querySelector('.brand').textContent.trim(),
        creator: document.querySelector('footer small').textContent.trim()
      };
      const mergeOption = [...document.querySelector('#quality-select').options].find(option => option.dataset.requiresFfmpeg === 'true');
      if (!mergeOption) throw new Error('FFmpeg merge format not found');
      document.querySelector('#quality-select').value = mergeOption.value;
      let resetWarning = '';
      const originalAlert = window.alert;
      window.alert = message => { resetWarning = String(message); };
      document.querySelector('#download-button').click();
      await waitFor(() => document.querySelector('#download-button').disabled);
      document.querySelector('#reset-button').click();
      const resetBlockedDuringDownload = resetWarning.includes('다운로드가 진행 중')
        && !document.querySelector('#result').classList.contains('hidden');
      window.alert = originalAlert;
      await waitFor(() => document.querySelector('#download-status').textContent.includes('저장했습니다.'), 300000);
      const videoStatus = document.querySelector('#download-status').textContent;
      document.querySelector('[data-mode="audio"]').click();
      document.querySelector('#download-button').click();
      await waitFor(() => document.querySelector('#download-status').textContent !== videoStatus);
      await waitFor(() => document.querySelector('#download-status').textContent.includes('저장했습니다.'), 300000);
      const audioStatus = document.querySelector('#download-status').textContent;

      const codecMediaResponse = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' })
      });
      const codecMedia = await codecMediaResponse.json();
      const downloadCodec = async (id, codec, ext) => {
        const metadata = {
          ...codecMedia,
          title: 'Codec ' + codec,
          formats: [{
            id, label: '240p', height: 240, ext, hasAudio: false,
            codec: codec.toLowerCase(), requiresFfmpeg: true
          }]
        };
        const response = await fetch('/api/downloads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ metadata, mode: 'video', formatId: id })
        });
        const created = await response.json();
        if (!response.ok) throw new Error(created.message);
        const ready = await waitFor(async () => {
          const statusResponse = await fetch('/api/downloads/' + created.id);
          const job = await statusResponse.json();
          if (job.status === 'failed') throw new Error(job.error);
          return job.status === 'ready' ? job : null;
        }, 300000);
        const savePath = await window.clipPortDesktop.chooseSavePath({
          suggestedName: 'Codec ' + codec + '.mp4', extension: 'mp4'
        });
        if (savePath.canceled) throw new Error('Codec test save canceled');
        await window.clipPortDesktop.saveDownload({ jobId: ready.id, filePath: savePath.filePath });
        return true;
      };
      const av1 = await downloadCodec('395', 'AV1', 'mp4');
      const vp9 = await downloadCodec('242', 'VP9', 'webm');

      document.querySelector('#reset-button').click();
      const resetState = {
        urlCleared: document.querySelector('#media-url').value === '',
        resultHidden: document.querySelector('#result').classList.contains('hidden'),
        formatsCleared: document.querySelector('#quality-select').options.length === 0,
        videoMode: document.querySelector('[data-mode="video"]').classList.contains('active'),
        messageCleared: document.querySelector('#download-status').textContent === ''
      };
      document.querySelector('#media-url').value = 'https://www.youtube.com/watch?v=M7lc1UVf-VE';
      document.querySelector('#analyze-form').requestSubmit();
      await waitFor(() => !document.querySelector('#result').classList.contains('hidden')
        && document.querySelector('#title').textContent !== analyzed.title);
      return {
        ...analyzed,
        videoStatus,
        audioStatus,
        resetBlockedDuringDownload,
        av1,
        vp9,
        resetState,
        secondTitle: document.querySelector('#title').textContent
      };
    })()
  `, true);
  await fsp.writeFile(reportPath, JSON.stringify(result, null, 2));
  app.quit();
}
