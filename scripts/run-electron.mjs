import { spawn } from 'node:child_process';
import electronPath from 'electron';

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: environment,
  stdio: 'inherit',
  windowsHide: false
});

child.once('error', error => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`Electron이 ${signal} 신호로 종료되었습니다.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
