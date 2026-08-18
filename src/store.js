import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge } from 'reactflow';
import { getTool } from '../server/tools.js';

let _id = 1;
const uid = (p = 'n') => `${p}_${Date.now().toString(36)}_${_id++}`;

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
    };
    set({ nodes: [...get().nodes, node], selectedId: id });
    return id;
  },

  updateNodeData: (id, patch) =>
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) }),

  deleteNode: (id) =>
    set({ nodes: get().nodes.filter((n) => n.id !== id), edges: get().edges.filter((e) => e.source !== id && e.target !== id), selectedId: get().selectedId === id ? null : get().selectedId }),

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
      inputs[inp.key] = inp.multi ? vals : (vals[0] ?? undefined);
    }
    return inputs;
  },

  runNode: async (nodeId) => {
    const { nodes, resolveInputs, updateNodeData, addJob, updateJob, addAsset } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.data.kind !== 'tool') return;
    const def = getTool(node.data.tool);
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
        const assets = (j.assets || []).map((a) => ({ ...a, url: viewUrl(a) }));
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

  addJob: (job) => set({ jobs: [...get().jobs, job] }),
  updateJob: (id, patch) => set({ jobs: get().jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }),
}));
