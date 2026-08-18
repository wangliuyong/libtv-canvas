import React, { useEffect, useState, useRef } from 'react';
import Canvas from './components/Canvas.jsx';
import NodeModal from './components/NodeModal.jsx';
import AssetDrawer from './components/AssetDrawer.jsx';
import StatusBar from './components/StatusBar.jsx';
import Icon from './components/icons.jsx';
import { useStore } from './store.js';

export default function App() {
  const fetchModels = useStore((s) => s.fetchModels);
  const fetchRemoteList = useStore((s) => s.fetchRemoteList);
  const toggleAssetDrawer = useStore((s) => s.toggleAssetDrawer);
  const assetCount = useStore((s) => s.assets.length);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const setNodes = useStore((s) => s.setNodes);
  const setEdges = useStore((s) => s.setEdges);
  const [backendDown, setBackendDown] = useState(false);
  const [projTip, setProjTip] = useState('');
  const fileRef = useRef(null);

  useEffect(() => { fetchModels(); }, [fetchModels]);
  useEffect(() => { fetchRemoteList(); }, [fetchRemoteList]);

  // 探测后端（localhost:8787）连通性：断了显示警告并持续重试，恢复后自动消失
  useEffect(() => {
    let timer;
    const check = async () => {
      try {
        const r = await fetch('/api/models');
        const ok = r.ok;
        setBackendDown(!ok);
        if (!ok) timer = setTimeout(check, 4000);
      } catch {
        setBackendDown(true);
        timer = setTimeout(check, 4000);
      }
    };
    check();
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!projTip) return;
    const t = setTimeout(() => setProjTip(''), 2500);
    return () => clearTimeout(t);
  }, [projTip]);

  // 工作流下载为本地 JSON（保存 / 导出共用）
  const downloadJSON = (filename) => {
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
  };

  const saveWf = () => { downloadJSON('libtv-workflow.json'); setProjTip('已保存 · libtv-workflow.json'); };
  const exportProject = () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadJSON(`libtv-project-${stamp}.json`);
    setProjTip('已导出项目 JSON');
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
        setProjTip('已导入工作流');
      } catch (err) { alert('导入失败：' + err.message); }
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  return (
    <div className="app">
      {backendDown && (
        <div className="backend-warn">
          <Icon name="xCircle" size={14} />
          <span>后端未连接（localhost:8787）——上传 / 生成功能不可用，请先运行 <code>npm run server</code></span>
        </div>
      )}
      <header className="topbar">
        <span className="logo"><span className="logo-mark"><Icon name="clapperboard" size={18} /></span> LibTV 式画布</span>
   
        <StatusBar />
        <div className="top-actions">
          <button className="icon-btn" onClick={saveWf} title="保存工作流"><Icon name="save" size={16} /> 保存</button>
          <button className="icon-btn" onClick={exportProject} title="导出 JSON"><Icon name="download" size={16} /> 导出</button>
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="导入 JSON"><Icon name="upload" size={16} /> 导入</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={importProject} />
          {projTip && <span className="proj-tip">{projTip}</span>}
          <button className="icon-btn" onClick={toggleAssetDrawer} title="资产库">
            <Icon name="folderOpen" size={16} /> 资产{assetCount ? ` (${assetCount})` : ''}
          </button>
        </div>
      </header>
      <div className="body">
        <div className="center">
          <Canvas />

        </div>
      </div>
      <AssetDrawer />
      <NodeModal />
    </div>
  );
}
