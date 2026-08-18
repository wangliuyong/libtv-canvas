// Express 服务：封装 ComfyUI，提供 LibTV 画布前端所需的 REST 接口。
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { queuePrompt, getHistory, getQueue, getObjectInfo, uploadBuffer, fetchAssetBytes, clientId, COMFY_BASE } from './comfy.js';
import { translate, TOOLS, MINIMAX, getTool } from './tools.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage() });
let MODELS = null;

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

// /view 代理（缩略图/预览）
app.get('/api/view', async (req, res) => {
  try {
    const { filename, subfolder = '', type = 'output' } = req.query;
    const qs = new URLSearchParams({ filename, type });
    if (subfolder) qs.set('subfolder', subfolder);
    const r = await fetch(`${COMFY_BASE}/view?${qs}`);
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

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`[libtv-canvas] backend on http://localhost:${PORT}  -> ComfyUI ${COMFY_BASE}`));
