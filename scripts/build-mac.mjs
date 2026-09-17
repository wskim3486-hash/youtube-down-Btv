import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  throw new Error('macOS 패키징은 Mac에서만 실행할 수 있습니다.');
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stagingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'clipport-mac-build-'));
const outputDirectory = path.join(root, 'dist');
const builder = path.join(root, 'node_modules', '.bin', 'electron-builder');

try {
  await run(builder, ['--mac', `--config.directories.output=${stagingDirectory}`]);
  await fs.mkdir(outputDirectory, { recursive: true });

  const entries = await fs.readdir(stagingDirectory, { withFileTypes: true });
  const artifacts = entries.filter(entry => entry.isFile() && /\.(dmg|blockmap|ya?ml)$/i.test(entry.name));
  if (!artifacts.some(entry => entry.name.endsWith('.dmg'))) {
    throw new Error('생성된 macOS DMG를 찾을 수 없습니다.');
  }

  for (const entry of artifacts) {
    await fs.copyFile(path.join(stagingDirectory, entry.name), path.join(outputDirectory, entry.name));
  }
  console.log(`macOS 패키징 완료: ${outputDirectory}`);
} finally {
  await fs.rm(stagingDirectory, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(signal
        ? `electron-builder가 ${signal} 신호로 종료되었습니다.`
        : `electron-builder가 종료 코드 ${code}로 실패했습니다.`));
    });
  });
}
