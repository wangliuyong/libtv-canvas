import React, { useRef } from 'react';
import ReactFlow, { Background, Controls, MiniMap, useReactFlow, ReactFlowProvider } from 'reactflow';
import { useStore } from '../store.js';
import { AssetNode, ToolNode } from './nodes.jsx';

const nodeTypes = { asset: AssetNode, tool: ToolNode };

function Flow() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const onNodesChange = useStore((s) => s.onNodesChange);
  const onEdgesChange = useStore((s) => s.onEdgesChange);
  const onConnect = useStore((s) => s.onConnect);
  const setSelected = useStore((s) => s.setSelected);
  const addAssetNode = useStore((s) => s.addAssetNode);
  const addToolNode = useStore((s) => s.addToolNode);
  const openNodeModal = useStore((s) => s.openNodeModal);
  const rf = useReactFlow();
  const wrapRef = useRef(null);

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

  return (
    <div className="canvas-wrap" ref={wrapRef} onDoubleClick={onDoubleClick}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => setSelected(n.id)}
        onNodeDoubleClick={(_, n) => openNodeModal(n.id)}
        onPaneClick={() => setSelected(null)}
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
