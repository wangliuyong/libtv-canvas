import React, { useEffect } from 'react';
import Canvas from './components/Canvas.jsx';
import Toolbar from './components/Toolbar.jsx';
import NodeModal from './components/NodeModal.jsx';
import AssetDrawer from './components/AssetDrawer.jsx';
import StatusBar from './components/StatusBar.jsx';
import Icon from './components/icons.jsx';
import { useStore } from './store.js';

export default function App() {
  const fetchModels = useStore((s) => s.fetchModels);
  const nodeDrawerCollapsed = useStore((s) => s.nodeDrawerCollapsed);
  const toggleNodeDrawer = useStore((s) => s.toggleNodeDrawer);
  const toggleAssetDrawer = useStore((s) => s.toggleAssetDrawer);
  const assetCount = useStore((s) => s.assets.length);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  return (
    <div className="app">
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
