// 零依赖开发启动器：并行拉起前端（Vite 5173）与后端（Express 8787）。
// 用法：npm run dev:all  （Ctrl+C 会同时关闭两个进程）
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');
const backend = resolve(root, 'server/index.js');

const children = [];

function tag(prefix, color, stream, out) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      out.write(`${color}[${prefix}]${'\x1b[0m'} ${line}\n`);
    }
  });
  stream.on('end', () => { if (buf) out.write(`${color}[${prefix}]${'\x1b[0m'} ${buf}\n`); });
}

function launch(name, prefix, color, cmd, args, env) {
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout && tag(prefix, color, child.stdout, process.stdout);
  child.stderr && tag(prefix, color, child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    process.stderr.write(`${color}[${prefix}]${'\x1b[0m'} 进程退出 (code=${code ?? ''} signal=${signal ?? ''})\n`);
    // 任一进程退出则一并关闭另一个，避免孤儿进程
    shutdown();
  });
  child.on('error', (err) => process.stderr.write(`${color}[${prefix}]${'\x1b[0m'} 启动失败: ${err.message}\n`));
  children.push(child);
  console.log(`${color}[${prefix}]${'\x1b[0m'} 已启动: ${cmd} ${args.join(' ')}`);
}

function shutdown() {
  for (const c of children) { try { if (!c.killed) c.kill('SIGTERM'); } catch { /* noop */ } }
}

process.on('SIGINT', () => { console.log('\n\x1b[33m[dev:all]\x1b[0m 收到 SIGINT，正在关闭全部进程…'); shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });

if (!existsSync(viteBin)) {
  console.error('\x1b[31m[vite 未安装]\x1b[0m 请先运行 npm install');
  process.exit(1);
}
if (!existsSync(backend)) {
  console.error('\x1b[31m[后端缺失]\x1b[0m 找不到 server/index.js');
  process.exit(1);
}

launch('frontend', '前端', '\x1b[36m', process.execPath, [viteBin], {});
launch('backend', '后端', '\x1b[35m', process.execPath, [backend], { PORT: process.env.PORT || 8787 });
