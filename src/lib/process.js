import { spawn } from 'node:child_process';
import { AppError } from './errors.js';

export function run(command, args, { timeoutMs = 60_000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new AppError('외부 도구의 응답 시간이 초과되었습니다.', 504, 'PROCESS_TIMEOUT'));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => {
      clearTimeout(timer);
      const missing = error.code === 'ENOENT';
      reject(new AppError(
        missing ? `${command} 실행 파일을 찾을 수 없습니다. 설치 안내를 확인하세요.` : '미디어 도구를 실행하지 못했습니다.',
        503,
        missing ? 'TOOL_NOT_INSTALLED' : 'PROCESS_ERROR'
      ));
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new AppError(sanitizeToolError(stderr), 422, 'MEDIA_TOOL_ERROR'));
    });
  });
}

function sanitizeToolError(value) {
  const lastLine = value.trim().split(/\r?\n/).filter(Boolean).at(-1) || '미디어를 처리할 수 없습니다.';
  return lastLine.replace(/^ERROR:\s*/i, '').slice(0, 500);
}
