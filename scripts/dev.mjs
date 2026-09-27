// Запуск сервера и клиента одной командой: npm run dev
import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['run', 'server'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn('npm', ['run', 'client'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGINT');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
