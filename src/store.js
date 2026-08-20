import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge } from 'reactflow';
import { getTool } from '../server/tools.js';

let _id = 1;
const uid = (p = 'n') => `${p}_${Date.now().toString(36)}_${_id++}`;
const clone = (arr) => JSON.parse(JSON.stringify(arr));

// —— 多画布持久化（localStorage）——
// 结构：{ [id]: { id, name, createdAt, updatedAt, nodeCount, nodes, edges } }
const LS_KEY = 'libtv_canvases_v1';
function _readCanvases() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function _writeCanvases(map) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch {}
}
// 资产库持久化：首页/画布页共用同一份全局资产，刷新后不丢（最多保留 300 条元数据）
const ASSETS_KEY = 'libtv_assets_v1';
function _readAssets() {
  try { return JSON.parse(localStorage.getItem(ASSETS_KEY)) || []; } catch { return []; }
}
function _writeAssets(list) {
  try { localStorage.setItem(ASSETS_KEY, JSON.stringify(list.slice(0, 300))); } catch {}
}
function _metaList(map) {
  return Object.values(map)
    .map(({ id, name, createdAt, updatedAt, nodeCount }) => ({ id, name, createdAt, updatedAt, nodeCount: nodeCount || 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// —— 轻量路由（基于 URL hash，刷新/分享/前进后退天然保持，不引入 react-router）——
// 主页：#/   画布：#/c/<id>
function parseHash() {
  const h = (typeof location !== 'undefined' ? location.hash : '').replace(/^#/, '');
  const m = h.match(/^\/c\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}
function writeHash(id) {
  if (typeof location === 'undefined') return;
  const next = id ? '#/c/' + encodeURIComponent(id) : '#/';
  if (location.hash !== next) location.hash = next;
}
// 初始进入：若 URL 指向某个已存在的画布，直接打开它（刷新保持视图）
function _initialView() {
  const id = parseHash();
  if (id && _readCanvases()[id]) {
    const c = _readCanvases()[id];
    return { id, nodes: c.nodes || [], edges: c.edges || [] };
  }
  return { id: null, nodes: [], edges: [] };
}
const _init = _initialView();

// 节点默认尺寸：宽度固定（舒适初始宽度），高度由内容自适应；
// 作为 NodeResizer 的基准，缩放可双向生效。重置尺寸时恢复到这里。
const NODE_DEFAULT_STYLE = {
  asset: { width: 224 },
  tool: { width: 248 },
  group: { width: 240, height: 160 },
};

function viewUrl(a) {
  const qs = new URLSearchParams({ filename: a.filename, type: a.type || 'output' });
  if (a.subfolder) qs.set('subfolder', a.subfolder);
  return `/api/view?${qs}`;
}

// 提示词 @ 引用解析：@图片名/@声音名 → 参考图 / 参考声音，并净化提示词文本。
// 返回 { prompt, images, audios }；无有效引用时返回 null。
// images/audios 为 { reupload:{filename,subfolder,type} }（后端 pickName 兼容）。
function resolveAtRefs(prompt, assets) {
  const tokens = [];
  const re = /@([^\s@,，。；;]+)/g;
  let m;
  while ((m = re.exec(prompt))) tokens.push(m[1]);
  if (!tokens.length) return null;
  const images = [], audios = [];
  const used = new Set();
  for (const t of tokens) {
    const key = t.toLowerCase();
    const hit = assets.find((a) => a.filename && a.filename.toLowerCase().includes(key));
    if (!hit) continue;
    const val = { reupload: { filename: hit.filename, subfolder: hit.subfolder || '', type: hit.type || 'output' } };
    if (hit.media === 'audio') audios.push(val);
    else images.push(val);
    used.add(t);
  }
  if (!used.size) return null;
  let cleaned = prompt;
  for (const t of used) {
    cleaned = cleaned.replace(new RegExp('[\\s,，]*@' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ');
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return { prompt: cleaned, images, audios };
}

// —— 内置工作流模板（新建画布时可选，自动预铺节点与连线）——
function _defaultParams(def) {
  const p = {};
  (def.params || []).forEach((x) => { if (x.default !== undefined) p[x.key] = x.default; });
  return p;
}
function _toolNode(id, toolId, x, y) {
  const def = getTool(toolId);
  return {
    id, type: 'tool', position: { x, y },
    data: { kind: 'tool', tool: toolId, label: def.name, params: _defaultParams(def), status: 'idle', result: null, error: '' },
    style: { ...NODE_DEFAULT_STYLE.tool },
  };
}
function _assetNode(id, kind, x, y, data = {}) {
  const labels = { text: '文本', image: '图片', video: '视频', audio: '音频', script: '脚本' };
  return {
    id, type: 'asset', position: { x, y },
    data: { kind, label: data.label || labels[kind] || kind, text: data.text || '', filename: '', subfolder: '', type: 'input', assetUrl: '', ...data },
    style: { ...NODE_DEFAULT_STYLE.asset },
  };
}
function _edge(source, target, targetKey, sourceKind) {
  return { id: `e_${source}_${target}_${targetKey}`, source, target, sourceHandle: sourceKind, targetHandle: 'IN:' + targetKey, animated: true };
}

// MiniMax H3 视频生成：文生视频(t2v) + 首尾帧生视频(i2vfl) + 多参考图生视频(ref2v)
// 首尾帧 / 参考图节点可直接在卡片内输入提示词（支持 @ 引用资产库图片/声音）
function buildMiniMaxVideoTemplate() {
  const tPrompt = _assetNode('t_prompt', 'text', 60, 360, { label: '视频提示词', text: '镜头缓慢推进，暖色调，电影感，人物自然行走' });
  const tFirst = _assetNode('t_first', 'image', 60, 80, { label: '首帧图' });
  const tLast = _assetNode('t_last', 'image', 60, 260, { label: '尾帧图' });
  const tRef1 = _assetNode('t_ref1', 'image', 60, 620, { label: '参考图1' });
  const tRef2 = _assetNode('t_ref2', 'image', 60, 800, { label: '参考图2' });
  const t2v = _toolNode('t_t2v', 't2v', 560, 260);
  const i2vfl = _toolNode('t_i2vfl', 'i2vfl', 560, 560);
  i2vfl.data.refs = { prompt: '从首帧平滑过渡到尾帧，镜头稳定，主体保持一致' };
  const ref2v = _toolNode('t_ref2v', 'ref2v', 560, 860);
  ref2v.data.refs = { prompt: '保持参考图中的人物造型与场景一致，镜头缓慢横移' };
  const nodes = [tPrompt, tFirst, tLast, tRef1, tRef2, t2v, i2vfl, ref2v];
  const edges = [
    _edge('t_prompt', 't_t2v', 'prompt', 'text'),
    _edge('t_first', 't_i2vfl', 'first_frame', 'image'),
    _edge('t_last', 't_i2vfl', 'last_frame', 'image'),
    _edge('t_ref1', 't_ref2v', 'ref_images', 'image'),
    _edge('t_ref2', 't_ref2v', 'ref_images', 'image'),
  ];
  return { nodes, edges };
}

// 全工作流总览：预铺所有主流图文/视频工作流节点，并把资产输入连到各自的必需把手
function buildAllWorkflowsTemplate() {
  // —— 左侧资产输入（可复用，作为各工作流的入口）——
  const aText = _assetNode('w_text', 'text', 40, 40, { label: '文本提示词', text: '输入画面/运动描述…' });
  const aImg = _assetNode('w_img', 'image', 40, 210, { label: '参考图片' });
  const aVid = _assetNode('w_vid', 'video', 40, 380, { label: '参考视频' });
  const aAud = _assetNode('w_aud', 'audio', 40, 550, { label: '参考音频' });

  // —— 图像工作流（第 2 列）——
  const n_t2i = _toolNode('w_t2i', 't2i', 360, 40);
  const n_char3 = _toolNode('w_char3', 'char3view', 360, 175);
  const n_story = _toolNode('w_story', 'storyboard', 360, 310);
  const n_ref2i = _toolNode('w_ref2i', 'ref2i', 360, 445);
  const n_up = _toolNode('w_up', 'upscale', 360, 580);
  const n_color = _toolNode('w_color', 'color', 360, 715);
  const n_bg = _toolNode('w_bg', 'bg', 360, 850);

  // —— 视频工作流（第 3 列）——
  const n_t2v = _toolNode('w_t2v', 't2v', 720, 40);
  const n_i2v = _toolNode('w_i2v', 'i2v', 720, 175);
  const n_i2vfl = _toolNode('w_i2vfl', 'i2vfl', 720, 310);
  n_i2vfl.data.refs = { prompt: '从首帧平滑过渡，镜头稳定，主体一致' };
  const n_ref2v = _toolNode('w_ref2v', 'ref2v', 720, 445);
  n_ref2v.data.refs = { prompt: '保持参考图人物造型与场景一致，缓慢横移' };
  const n_a2v = _toolNode('w_a2v', 'a2v', 720, 580);
  n_a2v.data.refs = { prompt: '人物随音频节奏自然说话，口型同步' };
  const n_compose = _toolNode('w_compose', 'compose', 720, 715);
  const n_voice = _toolNode('w_voice', 'voiceswap', 720, 850);
  const n_interp = _toolNode('w_interp', 'interp', 720, 985);

  const nodes = [
    aText, aImg, aVid, aAud,
    n_t2i, n_char3, n_story, n_ref2i, n_up, n_color, n_bg,
    n_t2v, n_i2v, n_i2vfl, n_ref2v, n_a2v, n_compose, n_voice, n_interp,
  ];

  // —— 连线：资产 → 各工具的必需把手（部分可选把手也预连以演示流程）——
  const E = [];
  const txt = (t, k) => E.push(_edge('w_text', t, k, 'text'));
  const img = (t, k) => E.push(_edge('w_img', t, k, 'image'));
  const vid = (t, k) => E.push(_edge('w_vid', t, k, 'video'));
  const aud = (t, k) => E.push(_edge('w_aud', t, k, 'audio'));

  // 文本提示词 → 所有 prompt 把手
  ['w_t2i', 'w_char3', 'w_story', 'w_ref2i', 'w_bg', 'w_t2v', 'w_i2v', 'w_i2vfl', 'w_ref2v', 'w_a2v'].forEach((t) => txt(t, 'prompt'));
  // 图片 → 各图像/视频工具的图片把手
  img('w_ref2i', 'image');
  img('w_up', 'image');
  img('w_color', 'image');
  img('w_color', 'reference');
  img('w_bg', 'image');
  img('w_i2v', 'image');
  img('w_i2vfl', 'first_frame');
  img('w_i2vfl', 'last_frame');
  img('w_ref2v', 'ref_images');
  img('w_a2v', 'ref_images');
  // 视频 → 视频工具
  vid('w_compose', 'clip1');
  vid('w_voice', 'video');
  vid('w_interp', 'video');
  // 音频 → 音频工具
  aud('w_ref2v', 'audio');
  aud('w_a2v', 'audio');
  aud('w_voice', 'ref_audio');

  return { nodes, edges: E };
}

export const TEMPLATES = {
  blank: { id: 'blank', name: '空白画布', desc: '从零开始自由搭建', icon: 'plus' },
  minimax_video: {
    id: 'minimax_video', name: 'MiniMax H3 视频生成', desc: '文生视频 + 图生视频(首尾帧/参考图)，预铺节点与连线', icon: 'film',
    build: buildMiniMaxVideoTemplate,
  },
  all_workflows: {
    id: 'all_workflows', name: '全工作流总览', desc: '预铺所有主流图文/视频工作流节点与连线（文生图/角色三视图/分镜/参考生图/放大/调色/换背景 + 文生视频/图生视频/首尾帧/多参考/音频生视频/合成/换音色/补帧）', icon: 'grid',
    build: buildAllWorkflowsTemplate,
  },
};
export const TEMPLATE_LIST = Object.values(TEMPLATES);

export const useStore = create((set, get) => ({
  nodes: _init.nodes,
  edges: _init.edges,
  past: [],
  future: [],
  selectedId: null,
  models: null,
  assets: _readAssets(), // 全局资产库（localStorage 持久化）
  jobs: [], // 运行中的任务

  // —— UI 状态（不影响画布逻辑）——
  assetDrawerOpen: false,     // 资产库抽屉是否打开
  nodeModalId: null,          // 正在编辑属性的节点（双击打开）
  canvasLocked: false,        // 画布是否锁定（禁止平移/缩放）
  configOpen: false,          // ComfyUI 配置弹窗
  projTip: '',                // 顶部操作提示（toast）

  // —— 多画布 / 路由 ——
  canvases: [],               // 画布元数据列表（不含 nodes/edges 内容）
  currentCanvasId: _init.id,  // null 表示停留在主页；否则进入对应画布（由 URL hash 决定）

  setConfigOpen: (v) => set({ configOpen: v }),
  setProjTip: (msg) => {
    set({ projTip: msg });
    if (msg) setTimeout(() => { if (get().projTip === msg) set({ projTip: '' }); }, 2500);
  },

  // 画布读写（localStorage）
  loadCanvases: () => set({ canvases: _metaList(_readCanvases()) }),

  createCanvas: (name, templateId) => {
    const id = uid('cv');
    const now = Date.now();
    let nodes = [], edges = [];
    const tpl = templateId && TEMPLATES[templateId];
    if (tpl && tpl.build) {
      const built = tpl.build();
      nodes = built.nodes;
      edges = built.edges;
    }
    const map = _readCanvases();
    map[id] = { id, name: (name || '').trim() || '未命名画布', createdAt: now, updatedAt: now, nodeCount: nodes.length, nodes, edges };
    _writeCanvases(map);
    set({ canvases: _metaList(map), currentCanvasId: id, nodes, edges, selectedId: null, past: [], future: [] });
    writeHash(id);
    return id;
  },

  // 浏览器前进/后退或外部修改 hash → 同步当前视图（不存在的画布回落主页）
  _applyRoute: (id) => {
    if (!id) { set({ currentCanvasId: null, nodes: [], edges: [], selectedId: null, past: [], future: [] }); return; }
    const c = _readCanvases()[id];
    if (!c) { set({ currentCanvasId: null, nodes: [], edges: [], selectedId: null, past: [], future: [] }); return; }
    set({ currentCanvasId: id, nodes: c.nodes || [], edges: c.edges || [], selectedId: null, past: [], future: [] });
  },

  openCanvas: (id) => {
    const c = _readCanvases()[id];
    if (!c) { writeHash(null); return; }
    set({ currentCanvasId: id, nodes: c.nodes || [], edges: c.edges || [], selectedId: null, past: [], future: [] });
    writeHash(id);
  },

  deleteCanvas: (id) => {
    const map = _readCanvases();
    delete map[id];
    _writeCanvases(map);
    const isCurrent = get().currentCanvasId === id;
    set({
      canvases: _metaList(map),
      ...(isCurrent ? { currentCanvasId: null, nodes: [], edges: [], selectedId: null, past: [], future: [] } : {}),
    });
    if (isCurrent) writeHash(null);
  },

  renameCanvas: (id, name) => {
    const map = _readCanvases();
    if (!map[id]) return;
    map[id].name = (name || '').trim() || '未命名画布';
    map[id].updatedAt = Date.now();
    _writeCanvases(map);
    set({ canvases: _metaList(map) });
  },

  // 把当前画布内容落盘；内容无变化时跳过（避免打开即刷新时间）
  saveCurrentCanvas: () => {
    const id = get().currentCanvasId;
    if (!id) return;
    const map = _readCanvases();
    if (!map[id]) return;
    const nodes = get().nodes;
    const edges = get().edges;
    const prev = JSON.stringify({ n: map[id].nodes || [], e: map[id].edges || [] });
    const next = JSON.stringify({ n: nodes, e: edges });
    if (prev === next) return;
    map[id].nodes = nodes;
    map[id].edges = edges;
    map[id].nodeCount = nodes.length;
    map[id].updatedAt = Date.now();
    _writeCanvases(map);
    set({ canvases: _metaList(map) });
  },

  goHome: () => { set({ currentCanvasId: null, nodes: [], edges: [], selectedId: null, past: [], future: [] }); writeHash(null); },

  // 工作流下载 / 导入（保存·导出·导入共用）
  downloadJSON: (filename) => {
    const { nodes, edges } = get();
    const data = {
      version: 1,
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data, style: n.style || undefined })),
      edges,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },
  saveWf: () => { get().downloadJSON('libtv-workflow.json'); get().setProjTip('已保存 · libtv-workflow.json'); },
  exportProject: () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    get().downloadJSON(`libtv-project-${stamp}.json`);
    get().setProjTip('已导出项目 JSON');
  },
  importJSON: (file) => new Promise((resolve, reject) => {
    if (!file) return reject(new Error('未选择文件'));
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        set({ nodes: data.nodes || [], edges: data.edges || [] });
        get().saveCurrentCanvas();
        get().setProjTip('已导入工作流');
        resolve();
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('读取失败'));
    reader.readAsText(file);
  }),

  toggleAssetDrawer: () => set((s) => ({ assetDrawerOpen: !s.assetDrawerOpen })),
  toggleCanvasLock: () => set((s) => ({ canvasLocked: !s.canvasLocked })),
  openNodeModal: (id) => set({ nodeModalId: id }),
  closeNodeModal: () => set({ nodeModalId: null }),

  setSelected: (id) => set({ selectedId: id }),
  setNodes: (n) => { get().snapshot(); set({ nodes: n }); },
  setEdges: (e) => { get().snapshot(); set({ edges: e }); },

  // 撤销/重做：每次结构性变更前调用 snapshot()，把当前 nodes/edges 压入 past 并清空 future
  snapshot: () => set((s) => ({
    past: [...s.past, { nodes: clone(s.nodes), edges: clone(s.edges) }].slice(-100),
    future: [],
  })),
  undo: () => {
    const { past, nodes, edges, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      past: past.slice(0, -1),
      future: [...future, { nodes: clone(nodes), edges: clone(edges) }].slice(-100),
    });
  },
  redo: () => {
    const { future, nodes, edges, past } = get();
    if (!future.length) return;
    const next = future[future.length - 1];
    set({
      nodes: next.nodes,
      edges: next.edges,
      future: future.slice(0, -1),
      past: [...past, { nodes: clone(nodes), edges: clone(edges) }].slice(-100),
    });
  },

  onNodesChange: (c) => {
    // 仅在「删除」或「拖拽结束」这类提交型变更前记录快照（忽略拖拽过程、选中、尺寸等高频变更）
    if (c.some((ch) => ch.type === 'remove' || (ch.type === 'position' && ch.dragging === false))) get().snapshot();
    set({ nodes: applyNodeChanges(c, get().nodes) });
  },
  onEdgesChange: (c) => {
    if (c.some((ch) => ch.type === 'remove')) get().snapshot();
    set({ edges: applyEdgeChanges(c, get().edges) });
  },
  onConnect: (conn) => {
    // 目标把手为 IN:<输入key>；仅允许「上游输出媒体类型 === 目标输入类型」的连接
    const { nodes } = get();
    const targetNode = nodes.find((n) => n.id === conn.target);
    if (!targetNode || targetNode.type !== 'tool') return;
    const tdef = getTool(targetNode.data.tool);
    if (!tdef) return;
    const inp = tdef.inputs.find((i) => 'IN:' + i.key === conn.targetHandle);
    if (!inp) return; // 目标把手不匹配任何输入
    const srcType = conn.sourceHandle; // 资产/工具输出把手即媒体类型
    if (inp.type !== srcType) return; // 类型不匹配，禁止连接
    let edges = get().edges;
    // 非 multi 输入：同一把手上只允许一条连线，先移除旧连线
    if (!inp.multi) edges = edges.filter((e) => !(e.target === conn.target && e.targetHandle === conn.targetHandle));
    get().snapshot();
    set({ edges: addEdge({ ...conn, animated: true }, edges) });
  },

  addAssetNode: (kind, position) => {
    const labels = { text: '文本', image: '图片', video: '视频', audio: '音频', script: '脚本' };
    const id = uid(kind);
    const node = {
      id,
      type: 'asset',
      position: position || { x: 80 + Math.random() * 200, y: 80 + Math.random() * 200 },
      data: { kind, label: labels[kind] || kind, text: '', filename: '', subfolder: '', type: 'input', assetUrl: '' },
      style: { ...NODE_DEFAULT_STYLE.asset },
    };
    get().snapshot();
    set({ nodes: [...get().nodes, node], selectedId: id });
    return id;
  },

  addToolNode: (toolId, position) => {
    const def = getTool(toolId);
    if (!def) return;
    const id = uid('tool');
    const params = {};
    (def.params || []).forEach((p) => { if (p.default !== undefined) params[p.key] = p.default; });
    const node = {
      id,
      type: 'tool',
      position: position || { x: 360 + Math.random() * 200, y: 80 + Math.random() * 200 },
      data: { kind: 'tool', tool: toolId, label: def.name, params, status: 'idle', result: null, error: '' },
      style: { ...NODE_DEFAULT_STYLE.tool },
    };
    get().snapshot();
    set({ nodes: [...get().nodes, node], selectedId: id });
    return id;
  },

  // 在当前画布中插入一套预制工作流（模板）。重映射节点 id 避免与画布已有节点冲突，
  // 并自动排布到现有内容的右侧。传入 position 则以其为锚点（模板内部坐标叠加其上）。
  insertTemplate: (templateId, position) => {
    const tpl = TEMPLATES[templateId];
    if (!tpl || !tpl.build) return { nodes: [], edges: [] };
    const built = tpl.build();
    const idMap = {};
    // 默认排布：放在现有内容最右侧；无内容则从 (120,120) 起
    let startX = 120, startY = 120;
    const cur = get().nodes;
    if (cur.length) {
      const maxX = Math.max(...cur.map((n) => n.position.x + (n.width || 220)));
      const minY = Math.min(...cur.map((n) => n.position.y));
      startX = maxX + 80; startY = minY;
    }
    const anchor = position || { x: startX - 40, y: startY - 40 };
    const newNodes = built.nodes.map((n) => {
      const nid = uid(n.type === 'tool' ? 'tool' : (n.data?.kind || 'n'));
      idMap[n.id] = nid;
      return {
        ...n,
        id: nid,
        position: { x: anchor.x + (n.position?.x || 0), y: anchor.y + (n.position?.y || 0) },
        selected: false,
      };
    });
    const newEdges = built.edges.map((e) => ({
      ...e,
      id: `e_${idMap[e.source]}_${idMap[e.target]}_${e.targetHandle}`,
      source: idMap[e.source],
      target: idMap[e.target],
    }));
    get().snapshot();
    set({ nodes: [...get().nodes, ...newNodes], edges: [...get().edges, ...newEdges] });
    return { nodes: newNodes, edges: newEdges };
  },

  updateNodeData: (id, patch) =>
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) }),

  // 重置节点尺寸：恢复到创建时的默认尺寸（宽度固定、高度由内容自适应），而非清空
  resetNodeSize: (id) => {
    get().snapshot();
    set({ nodes: get().nodes.map((n) => {
      if (n.id !== id) return n;
      const def = NODE_DEFAULT_STYLE[n.type] || {};
      return { ...n, style: { ...def } };
    }) });
  },

  // 资产入库（本地上传 / 远程产出共用），按 filename+type+source 去重
  addAsset: (a) => {
    const exists = get().assets.some((x) => x.filename === a.filename && x.type === a.type && x.source === a.source);
    if (exists) return;
    const next = [...get().assets, a];
    _writeAssets(next);
    set({ assets: next });
  },

  deleteNode: (id) => {
    get().snapshot();
    set({ nodes: get().nodes.filter((n) => n.id !== id), edges: get().edges.filter((e) => e.source !== id && e.target !== id), selectedId: get().selectedId === id ? null : get().selectedId });
  },

  // 复制节点（偏移一点位置，避免完全重叠）
  duplicateNode: (id) => {
    const n = get().nodes.find((x) => x.id === id);
    if (!n) return;
    const nid = uid(n.type === 'tool' ? 'tool' : (n.data.kind || 'n'));
    const clone = JSON.parse(JSON.stringify(n));
    clone.id = nid;
    clone.position = { x: n.position.x + 48, y: n.position.y + 48 };
    clone.selected = false;
    clone.data = { ...clone.data, status: n.type === 'tool' ? 'idle' : clone.data.status, result: n.type === 'tool' ? null : clone.data.result, error: '' };
    get().snapshot();
    set({ nodes: [...get().nodes, clone], selectedId: nid });
    return nid;
  },

  clearCanvas: () => { get().snapshot(); set({ nodes: [], edges: [], selectedId: null, nodeModalId: null }); },

  // 多机位宫格：从一张图片/视频节点展开 cols×cols 个同源子节点（可单独替换/编辑）
  expandGrid: (nodeId, cols = 3) => {
    const src = get().nodes.find((n) => n.id === nodeId);
    if (!src || src.type !== 'asset') return [];
    const per = Math.max(2, Math.round(cols));
    const gap = 32, cellW = 200, cellH = 150;
    const totalW = per * (cellW + gap) - gap;
    const baseX = src.position.x + 280;
    const baseY = src.position.y - (per * (cellH + gap) - gap) / 2 + cellH / 2;
    const created = [];
    for (let r = 0; r < per; r++) {
      for (let c = 0; c < per; c++) {
        const nid = uid(src.data.kind || 'n');
        created.push({
          id: nid, type: 'asset',
          position: { x: baseX + c * (cellW + gap), y: baseY + r * (cellH + gap) },
          data: { ...JSON.parse(JSON.stringify(src.data)), label: `${src.data.label} · ${r * per + c + 1}`, gridRoot: nodeId },
        });
      }
    }
    get().snapshot();
    set({ nodes: [...get().nodes, ...created] });
    return created.map((c) => c.id);
  },

  // 画面推演：从关键帧往前/后延展 count 帧（同源副本，带方向标注）
  inferFrames: (nodeId, dir = 'after', count = 1) => {
    const src = get().nodes.find((n) => n.id === nodeId);
    if (!src || src.type !== 'asset') return [];
    const dx = dir === 'after' ? 280 : -280;
    const created = [];
    for (let i = 1; i <= count; i++) {
      const nid = uid(src.data.kind || 'n');
      created.push({
        id: nid, type: 'asset',
        position: { x: src.position.x + dx * i, y: src.position.y + 44 * i },
        data: { ...JSON.parse(JSON.stringify(src.data)), label: `推演 ${dir === 'after' ? '+' : '-'}${i * 3}s`, infer: dir },
      });
    }
    get().snapshot();
    set({ nodes: [...get().nodes, ...created] });
    return created.map((c) => c.id);
  },

  // 解析某工具节点的上游输入
  resolveInputs: (nodeId) => {
    const { nodes, edges } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return {};
    const def = getTool(node.data.tool);
    if (!def) return {};
    const inputs = {};
    const sourceValue = (sid, hType) => {
      const s = nodes.find((n) => n.id === sid);
      if (!s) return undefined;
      if (s.data.kind === 'tool') {
        const assets = (s.data.result && s.data.result.assets) || [];
        return assets.filter((a) => a.media === hType).map((a) => ({ reupload: { filename: a.filename, subfolder: a.subfolder, type: a.type } }));
      }
      if (hType === 'text') return s.data.text;
      return s.data.filename;
    };
    for (const inp of def.inputs) {
      let vals = edges
        .filter((e) => e.target === nodeId && e.targetHandle === 'IN:' + inp.key)
        .map((e) => sourceValue(e.source, e.sourceHandle))
        .filter((v) => v !== undefined);
      // 兼容旧画布：当该工具此类型输入唯一时，回退按媒体类型匹配把手
      if (vals.length === 0) {
        const sameType = def.inputs.filter((i) => i.type === inp.type);
        if (sameType.length === 1) {
          vals = edges
            .filter((e) => e.target === nodeId && e.targetHandle === inp.type)
            .map((e) => sourceValue(e.source, e.sourceHandle))
            .filter((v) => v !== undefined);
        }
      }
      if (vals.length > 0) {
        inputs[inp.key] = inp.multi ? vals : (vals[0] ?? undefined);
      } else if (node.data.refs && node.data.refs[inp.key] !== undefined) {
        // 无上游连线时，回退到属性面板里直接填写的参考/提示（multi 时为数组）
        inputs[inp.key] = node.data.refs[inp.key];
      }
    }
    // @ 引用加工：提示词中的 @图片/@声音 → 参考图/参考声音，并净化提示词文本
    // （调用 runNode 时执行，自动整理成 MiniMax H3 标准传参格式）
    const rawPrompt = inputs.prompt;
    if (typeof rawPrompt === 'string' && rawPrompt.includes('@')) {
      const at = resolveAtRefs(rawPrompt, get().assets);
      if (at) {
        inputs.prompt = at.prompt;
        if (at.images.length) {
          if (def.inputs.some((i) => i.key === 'ref_images')) {
            inputs.ref_images = [...(inputs.ref_images || []), ...at.images];
          } else {
            // 无参考图输入槽（如首尾帧节点）：依次填入首帧/尾帧
            if (!inputs.first_frame && at.images[0]) inputs.first_frame = at.images[0];
            if (!inputs.last_frame && at.images[1]) inputs.last_frame = at.images[1];
          }
        }
        if (at.audios.length) inputs.ref_audios = [...(inputs.ref_audios || []), ...at.audios];
      }
    }
    return inputs;
  },

  // 解析「视频合成」节点：把 clip1~clip4 上游视频整理为 {filename,subfolder,type} 列表（按序，跳过空位）
  resolveComposeClips: (nodeId) => {
    const { nodes, edges } = get();
    const order = ['clip1', 'clip2', 'clip3', 'clip4'];
    const clips = [];
    for (const h of order) {
      const conn = edges.find((e) => e.target === nodeId && e.targetHandle === 'IN:' + h);
      if (!conn) continue;
      const s = nodes.find((n) => n.id === conn.source);
      if (!s) continue;
      if (s.data.kind === 'tool') {
        const vs = (s.data.result && s.data.result.assets || []).filter((a) => a.media === 'video');
        if (vs[0]) clips.push({ filename: vs[0].filename, subfolder: vs[0].subfolder || '', type: vs[0].type || 'output' });
      } else if (s.data.filename) {
        clips.push({ filename: s.data.filename, subfolder: s.data.subfolder || '', type: s.data.type || 'output' });
      }
    }
    return clips;
  },

  runNode: async (nodeId) => {
    const { nodes, resolveInputs, updateNodeData, addJob, updateJob, addAsset } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.data.kind !== 'tool') return;
    const def = getTool(node.data.tool);

    // 视频合成：不走 ComfyUI 渲染，直接交给服务端 ffmpeg 拼接
    if (def.id === 'compose') {
      updateNodeData(nodeId, { status: 'running', error: '' });
      try {
        const clips = get().resolveComposeClips(nodeId);
        if (clips.length < 1) throw new Error('视频合成需要至少连接一个视频片段');
        const r = await fetch('/api/compose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clips, fps: (node.data.params || {}).fps }),
        });
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        const asset = { media: 'video', filename: j.filename, url: j.url, source: 'remote', label: j.filename };
        updateNodeData(nodeId, { status: 'success', result: { assets: [asset] } });
        addAsset(asset);
      } catch (e) {
        updateNodeData(nodeId, { status: 'error', error: String(e.message || e) });
      }
      return;
    }

    if (def.scaffold) { updateNodeData(nodeId, { error: '该工具为脚手架，尚未接入：' + def.desc }); return; }
    const params = node.data.params || {};
    const inputs = resolveInputs(nodeId);
    updateNodeData(nodeId, { status: 'running', error: '' });
    let prompt_id;
    try {
      const r = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: def.id, params, inputs }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      prompt_id = j.prompt_id;
    } catch (e) {
      updateNodeData(nodeId, { status: 'error', error: String(e.message || e) });
      return;
    }
    addJob({ id: prompt_id, nodeId, tool: def.name, status: 'running' });
    const poll = async () => {
      try {
        const r = await fetch(`/api/status/${prompt_id}`);
        const j = await r.json();
        if (j.status === 'running') { setTimeout(poll, 1500); return; }
        if (j.status === 'error') {
          updateNodeData(nodeId, { status: 'error', error: j.error || '生成失败' });
          updateJob(prompt_id, { status: 'error' });
          return;
        }
        const assets = (j.assets || []).map((a) => ({ ...a, url: viewUrl(a), source: 'remote', ts: Date.now() }));
        updateNodeData(nodeId, { status: 'success', result: { assets } });
        updateJob(prompt_id, { status: 'success' });
        const nextAssets = [...get().assets, ...assets];
        _writeAssets(nextAssets);
        set({ assets: nextAssets });
      } catch (e) {
        setTimeout(poll, 2000);
      }
    };
    setTimeout(poll, 1500);
  },

  // 提交任意 ComfyUI API 格式工作流，复用同一套轮询/产出逻辑（前端可直接触发实验性工作流）
  // 返回 { promptId, assets }；出错抛错。产物同时推入全局资产库。
  runWorkflow: async (prompt, { validate = false, client_id, onProgress } = {}) => {
    let promptId;
    try {
      const r = await fetch('/api/run-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, validate, client_id }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      promptId = j.prompt_id;
    } catch (e) {
      throw new Error(String(e.message || e));
    }
    return await new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const r = await fetch(`/api/status/${promptId}`);
          const j = await r.json();
          if (j.status === 'running') { if (onProgress) onProgress(j); setTimeout(poll, 1500); return; }
          if (j.status === 'error') { reject(new Error(j.error || '生成失败')); return; }
          const assets = (j.assets || []).map((a) => ({ ...a, url: viewUrl(a), source: 'remote', ts: Date.now() }));
          const nextAssets = [...get().assets, ...assets];
          _writeAssets(nextAssets);
          set({ assets: nextAssets });
          resolve({ promptId, assets });
        } catch (e) {
          setTimeout(poll, 2000);
        }
      };
      setTimeout(poll, 1500);
    });
  },

  fetchModels: async () => {
    if (get().models) return;
    try {
      const r = await fetch('/api/models');
      const j = await r.json();
      set({ models: j });
    } catch (e) { /* ignore */ }
  },

  // 拉取远程 ComfyUI 历史产出，回填到「远程」资产库（按 filename+type+source 去重）
  fetchRemoteList: async () => {
    try {
      const r = await fetch('/api/remote-list?max=60');
      const j = await r.json();
      if (!Array.isArray(j.assets)) return;
      set((s) => {
        const merged = [...s.assets];
        for (const a of j.assets) {
          const exists = merged.some((x) => x.filename === a.filename && x.type === a.type && x.source === a.source);
          if (!exists) merged.push(a);
        }
        _writeAssets(merged);
        return { assets: merged };
      });
    } catch (e) { /* ignore */ }
  },

  addJob: (job) => set({ jobs: [...get().jobs, job] }),
  updateJob: (id, patch) => set({ jobs: get().jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }),
}));

// 浏览器前进/后退或外部修改 hash → 同步画布视图（刷新后由 _initialView 恢复）
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const id = parseHash();
    useStore.getState()._applyRoute(id && _readCanvases()[id] ? id : null);
  });
}
