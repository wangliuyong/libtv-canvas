import React, { useRef, useState, useMemo } from 'react';
import ReactFlow, { Background, Controls, MiniMap, useReactFlow, ReactFlowProvider } from 'reactflow';
import { useStore } from '../store.js';
import { getTool } from '../../server/tools.js';
import { AssetNode, ToolNode, GroupNode } from './nodes.jsx';
import ContextMenu from './ContextMenu.jsx';

const nodeTypes = { asset: AssetNode, tool: ToolNode, group: GroupNode };

function Flow() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const onNodesChange = useStore((s) => s.onNodesChange);
  const onEdgesChange = useStore((s) => s.onEdgesChange);
  const onConnect = useStore((s) => s.onConnect);
  const setSelected = useStore((s) => s.setSelected);
  const addAssetNode = useStore((s) => s.addAssetNode);
  const addToolNode = useStore((s) => s.addToolNode);
  const duplicateNode = useStore((s) => s.duplicateNode);
  const deleteNode = useStore((s) => s.deleteNode);
  const clearCanvas = useStore((s) => s.clearCanvas);
  const expandGrid = useStore((s) => s.expandGrid);
  const inferFrames = useStore((s) => s.inferFrames);
  const setNodes = useStore((s) => s.setNodes);
  const openNodeModal = useStore((s) => s.openNodeModal);
  const runNode = useStore((s) => s.runNode);
  const selectedId = useStore((s) => s.selectedId);
  const rf = useReactFlow();
  const wrapRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const [tip, setTip] = useState('');

  // 屏幕坐标 → 画布坐标：扣掉容器偏移，再按当前视口(translate+zoom)反算，跨版本稳定精准
  const toFlow = (clientX, clientY) => {
    const bounds = wrapRef.current.getBoundingClientRect();
    const { x, y, zoom } = rf.getViewport();
    return {
      x: (clientX - bounds.left - x) / zoom,
      y: (clientY - bounds.top - y) / zoom,
    };
  };

  const onDoubleClick = (e) => {
    // 仅当双击在画布空白(pane)上时，新建一个文本节点
    if (!e.target.classList.contains('react-flow__pane')) return;
    addAssetNode('text', toFlow(e.clientX, e.clientY));
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/reactflow');
    if (!raw) return;
    let payload;
    try { payload = JSON.parse(raw); } catch { return; }
    const position = toFlow(e.clientX, e.clientY);
    if (payload.type === 'asset') addAssetNode(payload.kind, position);
    else if (payload.type === 'tool') addToolNode(payload.toolId, position);
  };

  // —— 分镜组：把选中的多个节点用 parent 嵌套进一个组容器 ——
  const groupSelected = () => {
    const all = rf.getNodes();
    const sel = all.filter((n) => n.selected && n.type !== 'group');
    if (sel.length < 2) { setTip('请先框选至少 2 个节点，再合并分镜组'); setTimeout(() => setTip(''), 2600); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    sel.forEach((n) => {
      const w = n.width || 220, h = n.height || 150;
      minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + w); maxY = Math.max(maxY, n.position.y + h);
    });
    const PAD = 44;
    const gx = minX - PAD, gy = minY - PAD, gw = (maxX - minX) + PAD * 2, gh = (maxY - minY) + PAD * 2;
    const gid = 'group_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const groupNode = { id: gid, type: 'group', position: { x: gx, y: gy }, data: { label: '分镜组' }, style: { width: gw, height: gh }, selected: false };
    const updated = get().nodes.map((n) => {
      if (sel.find((s) => s.id === n.id)) return { ...n, parentNode: gid, extent: 'parent', position: { x: n.position.x - gx, y: n.position.y - gy } };
      return n;
    });
    setNodes([groupNode, ...updated]);
  };

  const ungroup = (gid) => {
    const group = get().nodes.find((n) => n.id === gid);
    if (!group) return;
    const updated = get().nodes
      .filter((n) => n.id !== gid)
      .map((n) => (n.parentNode === gid
        ? { ...n, parentNode: undefined, extent: undefined, position: { x: n.position.x + group.position.x, y: n.position.y + group.position.y } }
        : n));
    setNodes(updated);
  };

  // —— 右键菜单 ——
  const onNodeContextMenu = (e, node) => {
    e.preventDefault();
    const items = [];
    if (node.type === 'tool') items.push({ label: '运行', icon: 'play', onClick: () => runNode(node.id) });
    if (node.type === 'asset' && (node.data.kind === 'image' || node.data.kind === 'video')) {
      items.push({ label: '展开九宫格', icon: 'grid', onClick: () => expandGrid(node.id, 3) });
      items.push({ label: '展开 25 宫格', icon: 'grid', onClick: () => expandGrid(node.id, 5) });
      items.push({ label: '向后推演', icon: 'film', onClick: () => inferFrames(node.id, 'after', 1) });
      items.push({ label: '向前推演', icon: 'film', onClick: () => inferFrames(node.id, 'before', 1) });
    }
    if (node.type === 'group') items.push({ label: '解组分镜组', icon: 'ungroup', onClick: () => ungroup(node.id) });
    items.push({ label: '复制', icon: 'copy', onClick: () => duplicateNode(node.id) });
    items.push({ label: '编辑属性', icon: 'edit', onClick: () => openNodeModal(node.id) });
    items.push({ label: '删除', icon: 'trash', danger: true, onClick: () => deleteNode(node.id) });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const onPaneContextMenu = (e) => {
    e.preventDefault();
    const selCount = rf.getNodes().filter((n) => n.selected).length;
    const items = [
      { label: '适配视图', icon: 'maximize', onClick: () => rf.fitView({ padding: 0.2, duration: 300 }) },
      { label: '全选', icon: 'check', onClick: () => setNodes(get().nodes.map((n) => ({ ...n, selected: true }))) },
    ];
    if (selCount >= 2) items.push({ label: '合并分镜组', icon: 'group', onClick: groupSelected });
    items.push({ label: '清空画布', icon: 'trash', danger: true, onClick: () => { if (confirm('确定清空整个画布？')) clearCanvas(); } });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // —— 选中节点时高亮其上下游连线与相关节点 ——
  const depNodeIds = useMemo(() => {
    const s = new Set();
    if (!selectedId) return s;
    s.add(selectedId);
    edges.forEach((e) => { if (e.source === selectedId) s.add(e.target); if (e.target === selectedId) s.add(e.source); });
    return s;
  }, [selectedId, edges]);

  const depEdgeIds = useMemo(() => {
    const s = new Set();
    if (!selectedId) return s;
    edges.forEach((e) => { if (e.source === selectedId || e.target === selectedId) s.add(e.id); });
    return s;
  }, [selectedId, edges]);

  const viewNodes = useMemo(
    () => nodes.map((n) => (depNodeIds.has(n.id) ? { ...n, className: (n.className ? n.className + ' ' : '') + 'dep' } : n)),
    [nodes, depNodeIds]
  );
  const viewEdges = useMemo(
    () => edges.map((e) => (depEdgeIds.has(e.id) ? { ...e, className: (e.className ? e.className + ' ' : '') + 'dep' } : e)),
    [edges, depEdgeIds]
  );

  return (
    <div className="canvas-wrap" ref={wrapRef} onDoubleClick={onDoubleClick}>
      <ReactFlow
        nodes={viewNodes}
        edges={viewEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => setSelected(n.id)}
        onNodeDoubleClick={(_, n) => openNodeModal(n.id)}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => setSelected(null)}
        onPaneContextMenu={onPaneContextMenu}
        onDrop={onDrop}
        onDragOver={onDragOver}
        fitView
        minZoom={0.1}
        maxZoom={3}
        zoomOnDoubleClick={false}
        defaultEdgeOptions={{ animated: true }}
      >
        <Background gap={20} color="#1c2330" />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      {tip && <div className="ctx-tip">{tip}</div>}
    </div>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
