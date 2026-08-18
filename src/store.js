import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge } from 'reactflow';
import { getTool } from '../server/tools.js';

let _id = 1;
const uid = (p = 'n') => `${p}_${Date.now().toString(36)}_${_id++}`;

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

export const useStore = create((set, get) => ({
  nodes: [],
  edges: [],
  selectedId: null,
  models: null,
  assets: [], // 全局资产库
  jobs: [], // 运行中的任务

  // —— UI 状态（不影响画布逻辑）——
  nodeDrawerCollapsed: false, // 左侧节点列表抽屉是否收起
  assetDrawerOpen: false,     // 资产库抽屉是否打开
  nodeModalId: null,          // 正在编辑属性的节点（双击打开）

  toggleNodeDrawer: () => set((s) => ({ nodeDrawerCollapsed: !s.nodeDrawerCollapsed })),
  toggleAssetDrawer: () => set((s) => ({ assetDrawerOpen: !s.assetDrawerOpen })),
  openNodeModal: (id) => set({ nodeModalId: id }),
  closeNodeModal: () => set({ nodeModalId: null }),

  setSelected: (id) => set({ selectedId: id }),
  setNodes: (n) => set({ nodes: n }),
  setEdges: (e) => set({ edges: e }),

  onNodesChange: (c) => set({ nodes: applyNodeChanges(c, get().nodes) }),
  onEdgesChange: (c) => set({ edges: applyEdgeChanges(c, get().edges) }),
  onConnect: (conn) => {
    // 仅允许 输出类型 === 输入类型 的连接
    if (conn.sourceHandle !== conn.targetHandle) return;
    set({ edges: addEdge({ ...conn, animated: true }, get().edges) });
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
    set({ nodes: [...get().nodes, node], selectedId: id });
    return id;
  },

  updateNodeData: (id, patch) =>
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) }),

  // 重置节点尺寸：恢复到创建时的默认尺寸（宽度固定、高度由内容自适应），而非清空
  resetNodeSize: (id) =>
    set({ nodes: get().nodes.map((n) => {
      if (n.id !== id) return n;
      const def = NODE_DEFAULT_STYLE[n.type] || {};
      return { ...n, style: { ...def } };
    }) }),

  // 资产入库（本地上传 / 远程产出共用），按 filename+type+source 去重
  addAsset: (a) =>
    set((s) => {
      const exists = s.assets.some((x) => x.filename === a.filename && x.type === a.type && x.source === a.source);
      if (exists) return {};
      return { assets: [...s.assets, a] };
    }),

  deleteNode: (id) =>
    set({ nodes: get().nodes.filter((n) => n.id !== id), edges: get().edges.filter((e) => e.source !== id && e.target !== id), selectedId: get().selectedId === id ? null : get().selectedId }),

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
    set({ nodes: [...get().nodes, clone], selectedId: nid });
    return nid;
  },

  clearCanvas: () => set({ nodes: [], edges: [], selectedId: null, nodeModalId: null }),

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
      const conn = edges.filter((e) => e.target === nodeId && e.targetHandle === inp.type);
      const vals = conn.map((e) => sourceValue(e.source, e.sourceHandle)).filter((v) => v !== undefined);
      if (vals.length > 0) {
        inputs[inp.key] = inp.multi ? vals : (vals[0] ?? undefined);
      } else if (node.data.refs && node.data.refs[inp.key] !== undefined) {
        // 无上游连线时，回退到属性面板里直接填写的参考/提示
        inputs[inp.key] = node.data.refs[inp.key];
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
      const conn = edges.find((e) => e.target === nodeId && e.targetHandle === h);
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
        set({ assets: [...get().assets, ...assets] });
      } catch (e) {
        setTimeout(poll, 2000);
      }
    };
    setTimeout(poll, 1500);
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
        return { assets: merged };
      });
    } catch (e) { /* ignore */ }
  },

  addJob: (job) => set({ jobs: [...get().jobs, job] }),
  updateJob: (id, patch) => set({ jobs: get().jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }),
}));
