import React, { useState } from 'react';
import { useStore } from '../store.js';
import { TOOLS } from '../../server/tools.js';
import Icon from './icons.jsx';

const BASIC = [
  { kind: 'text', label: '文本' },
  { kind: 'script', label: '脚本' },
  { kind: 'image', label: '图片' },
  { kind: 'video', label: '视频' },
  { kind: 'audio', label: '音频' },
];

const CAT_NAME = { image: '图像类', video: '视频类' };

export default function Toolbar() {
  const addAssetNode = useStore((s) => s.addAssetNode);
  const addToolNode = useStore((s) => s.addToolNode);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const setNodes = useStore((s) => s.setNodes);
  const setEdges = useStore((s) => s.setEdges);
  const [savedTip, setSavedTip] = useState('');

  const onDragStart = (e, payload) => {
    e.dataTransfer.setData('application/reactflow', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };

  // 直接把工作流下载为本地文件
  const downloadJSON = (filename) => {
    const data = {
      version: 1,
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
      edges,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const saveWf = () => {
    downloadJSON('libtv-workflow.json');
    setSavedTip('已保存到本地 · libtv-workflow.json');
    setTimeout(() => setSavedTip(''), 2500);
  };

  const exportProject = () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const name = `libtv-project-${stamp}.json`;
    downloadJSON(name);
    setSavedTip('已导出 · ' + name);
    setTimeout(() => setSavedTip(''), 2500);
  };

  const importProject = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        setNodes(data.nodes || []);
        setEdges(data.edges || []);
      } catch (err) { alert('导入失败：' + err.message); }
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  const grouped = {};
  TOOLS.forEach((t) => { (grouped[t.cat] = grouped[t.cat] || []).push(t); });

  return (
    <div className="toolbar">
      <div className="tb-sec">
        <div className="tb-title">基础节点</div>
        {BASIC.map((b) => (
          <button key={b.kind} className="tb-btn" draggable onDragStart={(e) => onDragStart(e, { type: 'asset', kind: b.kind })} onClick={() => addAssetNode(b.kind)}><Icon name={b.kind} /> {b.label}</button>
        ))}
      </div>

      <div className="tb-sec">
        <div className="tb-title">AI 工具</div>
        {Object.entries(grouped).map(([cat, list]) => (
          <div key={cat}>
            <div className="tb-sub">{CAT_NAME[cat] || cat}</div>
            {list.map((t) => (
              <button key={t.id} className={'tb-btn tool' + (t.scaffold ? ' scaf' : '')} draggable onDragStart={(e) => onDragStart(e, { type: 'tool', toolId: t.id })} onClick={() => addToolNode(t.id)} title={t.desc}>
                <Icon name={t.id} /> {t.name}{t.scaffold ? ' (脚手架)' : ''}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="tb-sec">
        <div className="tb-title">项目</div>
        <button className="tb-btn" onClick={saveWf}><Icon name="save" /> 保存工作流</button>
        <button className="tb-btn" onClick={exportProject}><Icon name="download" /> 导出 JSON</button>
        <label className="tb-btn file"><Icon name="upload" /> 导入 JSON<input type="file" accept="application/json" hidden onChange={importProject} /></label>
        {savedTip && <div className="saved-tip">{savedTip}</div>}
      </div>
      <div className="hint">拖拽左侧节点到画布添加<br />双击空白处快速添加文本</div>
    </div>
  );
}
