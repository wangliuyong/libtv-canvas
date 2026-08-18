import React, { useEffect, useState } from 'react';
import Canvas from './components/Canvas.jsx';
import Toolbar from './components/Toolbar.jsx';
import NodeModal from './components/NodeModal.jsx';
import AssetDrawer from './components/AssetDrawer.jsx';
import StatusBar from './components/StatusBar.jsx';
import Icon from './components/icons.jsx';
import { useStore } from './store.js';

export default function App() {
  const fetchModels = useStore((s) => s.fetchModels);
  const fetchRemoteList = useStore((s) => s.fetchRemoteList);
  const nodeDrawerCollapsed = useStore((s) => s.nodeDrawerCollapsed);
  const toggleNodeDrawer = useStore((s) => s.toggleNodeDrawer);
  const toggleAssetDrawer = useStore((s) => s.toggleAssetDrawer);
  const assetCount = useStore((s) => s.assets.length);
  const [backendDown, setBackendDown] = useState(false);

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

  return (
    <div className="app">
      {backendDown && (
        <div className="backend-warn">
          <Icon name="xCircle" size={14} />
          <span>后端未连接（localhost:8787）——上传 / 生成功能不可用，请先运行 <code>npm run server</code></span>
        </div>
      )}
      <header className="topbar">
        <button className="tb-toggle" onClick={toggleNodeDrawer} title={nodeDrawerCollapsed ? '展开节点列表' : '收起节点列表'}>
          <Icon name={nodeDrawerCollapsed ? 'panelLeftOpen' : 'panelLeftClose'} />
        </button>
        <span className="logo"><span className="logo-mark"><Icon name="clapperboard" size={18} /></span> LibTV 式画布</span>
        <span className="sub">无限画布 · 节点工作流 · 接入远程 ComfyUI</span>
        <div className="top-actions">
          <button className="icon-btn" onClick={toggleAssetDrawer} title="资产库">
            <Icon name="folderOpen" size={16} /> 资产{assetCount ? ` (${assetCount})` : ''}
          </button>
        </div>
      </header>
      <div className="body">
        <div className={'node-drawer' + (nodeDrawerCollapsed ? ' collapsed' : '')}>
          <Toolbar />
        </div>
        <div className="center">
          <Canvas />
          <StatusBar />
        </div>
      </div>
      <AssetDrawer />
      <NodeModal />
    </div>
  );
}
