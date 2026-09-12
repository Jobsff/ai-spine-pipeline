import { spawnSync, spawn } from 'node:child_process';
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const built = spawnSync(command, ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (built.status !== 0) process.exit(built.status || 1);
console.log('Development server. Re-run npm run build after changing HTML/CSS.');
const watch = spawn(process.platform === 'win32' ? 'tsc.cmd' : 'tsc', ['-p', 'tsconfig.json', '--watch'], { stdio: 'inherit', shell: process.platform === 'win32' });
process.on('exit', () => watch.kill());
process.on('SIGINT', () => process.exit(0));
await import('./serve.mjs');
