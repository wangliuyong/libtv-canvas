// Express 服务：封装 ComfyUI，提供 LibTV 画布前端所需的 REST 接口。
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { execFile } from 'child_process';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, writeFile, mkdtemp, rm, readFile } from 'fs/promises';
import { queuePrompt, getHistory, getQueue, getObjectInfo, uploadBuffer, fetchAssetBytes, clientId, viewUrl as comfyViewUrl, getComfyUrl, setComfyUrl } from './comfy.js';
import { translate, TOOLS, MINIMAX, getTool } from './tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage() });
let MODELS = null;

// 合成视频落地目录（由后端 /composed 静态服务，不依赖远程 ComfyUI 文件系统）
const COMPOSED_DIR = path.join(__dirname, 'composed');
await mkdir(COMPOSED_DIR, { recursive: true });
app.use('/composed', express.static(COMPOSED_DIR));

// 根据文件名后缀判断媒体类型（ComfyUI 历史里 mp4 也常放在 images 字段）
function mediaByExt(filename = '') {
  const ext = path.extname(filename).toLowerCase();
  if (['.mp4', '.webm', '.mov', '.mkv', '.flv', '.avi'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a'].includes(ext)) return 'audio';
  return 'image';
}

// ffmpeg 封装：非 0 退出视为失败（抛出 stderr）
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 1024 * 1024 * 512 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').slice(-800)));
      resolve(stdout);
    });
  });
}

async function loadModels() {
  if (MODELS) return MODELS;
  const info = await getObjectInfo();
  const opt = (node, key) => {
    const n = info[node];
    if (!n) return [];
    const v = n.input?.required?.[key] || n.input?.optional?.[key];
    if (!Array.isArray(v)) return [];
    if (Array.isArray(v[0])) return v[0]; // [options, meta?]
    if (typeof v[1] === 'object' && Array.isArray(v[1].options)) return v[1].options; // ["COMBO", {options}]
    if (Array.isArray(v[1])) return v[1]; // ["COMBO", options]
    return [];
  };
  MODELS = {
    checkpoints: opt('CheckpointLoaderSimple', 'ckpt_name'),
    upscale: opt('UpscaleModelLoader', 'model_name'),
    minimax: MINIMAX,
    tools: TOOLS,
  };
  return MODELS;
}

app.get('/api/models', async (req, res) => {
  try {
    res.json(await loadModels());
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 浏览器直传文件到 ComfyUI input 目录
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const buf = req.file.buffer;
    const name = req.file.originalname;
    const r = await uploadBuffer(buf, name);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 把 ComfyUI output 里已产出的文件回流到 input（实现 工具→工具 链路）
app.post('/api/reupload', express.json(), async (req, res) => {
  try {
    const { filename, subfolder, type } = req.body;
    const buf = await fetchAssetBytes(filename, subfolder, type || 'output');
    const r = await uploadBuffer(buf, filename);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 执行一个工具节点：解析输入 -> 翻译 -> 提交队列
app.post('/api/execute', async (req, res) => {
  try {
    const { tool, params = {}, inputs = {} } = req.body;
    const def = getTool(tool);
    if (!def) return res.status(400).json({ error: 'unknown tool ' + tool });
    if (def.scaffold) return res.status(501).json({ error: '该工具为脚手架，尚未接入节点图: ' + def.desc });

    // 解析需要回流的输入（来自上游工具产出的 output 文件）
    const resolved = {};
    for (const [k, v] of Object.entries(inputs)) {
      if (Array.isArray(v)) {
        resolved[k] = await Promise.all(v.map(async (x) => (x && x.reupload ? (await uploadBuffer(await fetchAssetBytes(x.reupload.filename, x.reupload.subfolder, x.reupload.type), x.reupload.filename)).name : x)));
      } else if (v && v.reupload) {
        resolved[k] = (await uploadBuffer(await fetchAssetBytes(v.reupload.filename, v.reupload.subfolder, v.reupload.type), v.reupload.filename)).name;
      } else {
        resolved[k] = v;
      }
    }

    if (!resolved.prompt && params.prompt) resolved.prompt = params.prompt;
    const { prompt, saveNodes } = translate(tool, params, resolved);
    const cid = clientId();
    const { prompt_id } = await queuePrompt(prompt, cid);
    res.json({ prompt_id, saveNodes });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 轮询任务状态与产出
app.get('/api/status/:promptId', async (req, res) => {
  try {
    const { promptId } = req.params;
    const hist = await getHistory(promptId);
    const rec = hist && hist[promptId];
    if (!rec) {
      const q = await getQueue();
      const running = q.queue_running.some((x) => x[1] === promptId);
      const pending = q.queue_pending.some((x) => x[1] === promptId);
      return res.json({ status: running || pending ? 'running' : 'running' });
    }
    if (rec.status && rec.status.status_str === 'error') return res.json({ status: 'error', error: rec.status.message || 'ComfyUI error' });
    const assets = [];
    for (const [nodeId, out] of Object.entries(rec.outputs || {})) {
      for (const im of out.images || []) assets.push({ media: 'image', filename: im.filename, subfolder: im.subfolder || '', type: im.type || 'output', nodeId });
      for (const v of out.videos || []) assets.push({ media: 'video', filename: v.filename, subfolder: v.subfolder || '', type: v.type || 'output', nodeId });
      for (const a of out.audios || []) assets.push({ media: 'audio', filename: a.filename, subfolder: a.subfolder || '', type: a.type || 'output', nodeId });
    }
    res.json({ status: 'success', assets });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/queue', async (req, res) => {
  try { res.json(await getQueue()); } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// ComfyUI 远程地址配置：可运行时修改并持久化到 config.local.json
app.get('/api/config', (req, res) => {
  res.json({ comfyUrl: getComfyUrl() });
});

app.post('/api/config', express.json(), (req, res) => {
  try {
    const { comfyUrl } = (req.body || {});
    const url = setComfyUrl(comfyUrl);
    res.json({ comfyUrl: url });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// /view 代理（缩略图/预览）
app.get('/api/view', async (req, res) => {
  try {
    const { filename, subfolder = '', type = 'output' } = req.query;
    const qs = new URLSearchParams({ filename, type });
    if (subfolder) qs.set('subfolder', subfolder);
    const r = await fetch(`${getComfyUrl()}/view?${qs}`);
    if (!r.ok) return res.status(404).end();
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(buf);
  } catch (e) {
    res.status(500).end();
  }
});

// 远程图库：列举 ComfyUI 历史产出（图片/视频/音频），回流为可引用资产
app.get('/api/remote-list', async (req, res) => {
  try {
    const max = Math.min(200, Math.max(1, parseInt(req.query.max) || 50));
    const r = await fetch(`${getComfyUrl()}/history?max_items=${max}`);
    if (!r.ok) return res.status(502).json({ error: 'ComfyUI history 失败: ' + r.status });
    const hist = await r.json();
    const seen = new Set();
    const assets = [];
    // history 是 { prompt_id: { outputs: { nodeId: { images|gifs|videos|audios: [...] } } } }
    for (const rec of Object.values(hist || {})) {
      const outputs = rec && rec.outputs;
      if (!outputs) continue;
      // 以该次任务最近一条消息的时间戳作为完成时间（用于按时间倒序）
      const msgs = (rec.status && rec.status.messages) || [];
      const ts = msgs.reduce((m, mm) => Math.max(m, (mm && mm[1] && mm[1].timestamp) || 0), 0);
      for (const out of Object.values(outputs)) {
        const buckets = ['images', 'gifs', 'videos', 'audios'];
        for (const key of buckets) {
          for (const f of out[key] || []) {
            const filename = f.filename;
            if (!filename) continue;
            const subfolder = f.subfolder || '';
            const type = f.type || 'output';
            const dedup = `${filename}|${subfolder}|${type}`;
            if (seen.has(dedup)) continue;
            seen.add(dedup);
            assets.push({
              media: mediaByExt(filename),
              filename,
              subfolder,
              type,
              source: 'remote',
              gallery: true,
              ts,
              url: comfyViewUrl(filename, subfolder, type),
            });
          }
        }
      }
    }
    // 默认按完成时间倒序（最新在前）
    assets.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    res.json({ assets });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 视频合成：把多条远程视频片段按序拼接（服务端 ffmpeg concat）
app.post('/api/compose', express.json(), async (req, res) => {
  try {
    const { clips = [], fps = 24 } = req.body;
    const valid = (clips || []).filter((c) => c && c.filename);
    if (valid.length < 1) return res.status(400).json({ error: '至少需要一个视频片段' });

    const tmp = await mkdtemp(path.join(os.tmpdir(), 'libtv-compose-'));
    try {
      // 1) 把每个片段字节拉到本地临时目录
      const paths = [];
      for (let i = 0; i < valid.length; i++) {
        const c = valid[i];
        const buf = await fetchAssetBytes(c.filename, c.subfolder || '', c.type || 'output');
        const ext = path.extname(c.filename) || '.mp4';
        const p = path.join(tmp, `clip_${i}${ext}`);
        await writeFile(p, buf);
        paths.push(p);
      }
      // 2) 构造 ffmpeg concat 列表（绝对路径，safe 0）
      const listTxt = paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
      const listPath = path.join(tmp, 'list.txt');
      await writeFile(listPath, listTxt);

      const outName = `compose_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`;
      const outPath = path.join(COMPOSED_DIR, outName);

      // 3) 逐级回退：copy -> 重编码(带音频) -> 重编码(去音频)
      const attempts = [
        ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath],
        ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-r', String(fps | 0 || 24), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', outPath],
        ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-r', String(fps | 0 || 24), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', outPath],
      ];
      let lastErr;
      let ok = false;
      for (const args of attempts) {
        try { await runFFmpeg(args); ok = true; break; }
        catch (e) { lastErr = e; }
      }
      if (!ok) throw lastErr || new Error('ffmpeg 拼接失败');

      const stat = await import('fs/promises').then((m) => m.stat(outPath));
      if (!stat.size) throw new Error('合成结果文件为空');

      res.json({ media: 'video', filename: outName, url: `/composed/${outName}`, source: 'remote' });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`[libtv-canvas] backend on http://localhost:${PORT}  -> ComfyUI ${getComfyUrl()}`));
