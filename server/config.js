// ComfyUI 远程地址配置：运行时可经 /api/config 修改并持久化到 config.local.json。
// 优先级：环境变量 COMFY_URL > config.local.json > 默认占位（默认不含真实地址，避免写死）。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_CONFIG = path.join(__dirname, 'config.local.json');

function loadLocalConfig() {
  try {
    const raw = fs.readFileSync(LOCAL_CONFIG, 'utf8');
    const j = JSON.parse(raw);
    return (j && j.comfyUrl) || '';
  } catch {
    return '';
  }
}

let _comfyUrl = process.env.COMFY_URL || loadLocalConfig() || 'http://localhost:8188';

export function getComfyUrl() {
  return _comfyUrl;
}

export function setComfyUrl(url) {
  const trimmed = (url || '').trim();
  if (!/^https?:\/\/.+/i.test(trimmed)) {
    throw new Error('地址必须以 http:// 或 https:// 开头');
  }
  _comfyUrl = trimmed;
  // 持久化到本地配置（已被 .gitignore 忽略，不入库）；写盘失败不阻塞内存生效
  try {
    fs.writeFileSync(LOCAL_CONFIG, JSON.stringify({ comfyUrl: _comfyUrl }, null, 2));
  } catch {
    /* ignore */
  }
  return _comfyUrl;
}
