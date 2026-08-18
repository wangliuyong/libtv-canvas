// 低层 ComfyUI HTTP 客户端：队列、历史、上传、取流。
// 目标实例地址运行时可配置（见 server/config.js），不再写死在代码里。
import { getComfyUrl, setComfyUrl } from './config.js';
export { getComfyUrl, setComfyUrl };

async function jpost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`ComfyUI ${url} -> ${r.status}: ${t.slice(0, 400)}`);
  }
  return r.json();
}

export function clientId() {
  return 'libtv_' + Math.random().toString(36).slice(2, 10);
}

// 提交一个 API 格式的 prompt，返回 { prompt_id }
export async function queuePrompt(prompt, cid) {
  return jpost(`${getComfyUrl()}/api/prompt`, { prompt, client_id: cid });
}

// 取某次任务历史（含输出文件信息）
export async function getHistory(promptId) {
  const r = await fetch(`${getComfyUrl()}/api/history/${promptId}`);
  if (!r.ok) return null;
  return r.json();
}

export async function getQueue() {
  const r = await fetch(`${getComfyUrl()}/api/queue`);
  if (!r.ok) return { queue_running: [], queue_pending: [] };
  return r.json();
}

export async function getObjectInfo() {
  const r = await fetch(`${getComfyUrl()}/object_info`);
  if (!r.ok) throw new Error('object_info failed');
  return r.json();
}

// 上传图片/视频到 ComfyUI input 目录，返回 { name, subfolder, type }
export async function uploadBuffer(buffer, name) {
  const form = new FormData();
  form.append('image', new Blob([buffer], { type: 'application/octet-stream' }), name);
  const r = await fetch(`${getComfyUrl()}/upload/image`, { method: 'POST', body: form });
  if (!r.ok) throw new Error('upload failed ' + r.status);
  return r.json();
}

// 从 ComfyUI 取一个已产出文件的字节（用于工具链路里把 output 文件回流到 input）
export async function fetchAssetBytes(filename, subfolder = '', type = 'output') {
  const qs = new URLSearchParams({ filename, type });
  if (subfolder) qs.set('subfolder', subfolder);
  const r = await fetch(`${getComfyUrl()}/view?${qs}`);
  if (!r.ok) throw new Error('view failed ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// /view 代理 URL（前端缩略图用）
export function viewUrl(filename, subfolder = '', type = 'output') {
  const qs = new URLSearchParams({ filename, type });
  if (subfolder) qs.set('subfolder', subfolder);
  return `/api/view?${qs}`;
}
