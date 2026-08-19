import React, { useRef } from 'react';
import Icon from './icons.jsx';
import StatusBar from './StatusBar.jsx';
import { useStore } from '../store.js';

// 共享顶栏：主页与画布页统一复用。
// 画布相关操作（返回 / 保存 / 导出 / 导入 / 资产）仅在打开画布时显示；配置按钮始终显示。
export default function Header() {
  const isCanvas = useStore((s) => !!s.currentCanvasId);
  const assetCount = useStore((s) => s.assets.length);
  const projTip = useStore((s) => s.projTip);
  const setConfigOpen = useStore((s) => s.setConfigOpen);
  const toggleAssetDrawer = useStore((s) => s.toggleAssetDrawer);
  const goHome = useStore((s) => s.goHome);
  const saveWf = useStore((s) => s.saveWf);
  const exportProject = useStore((s) => s.exportProject);
  const importJSON = useStore((s) => s.importJSON);
  const setProjTip = useStore((s) => s.setProjTip);
  const fileRef = useRef(null);

  const onImport = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    importJSON(f).catch((err) => setProjTip('导入失败：' + err.message));
    e.target.value = '';
  };

  return (
    <header className="topbar">
      <span className="logo">
        <span className="logo-mark"><Icon name="clapperboard" size={18} /></span>
        LibTV 式画布
      </span>
      <StatusBar />
      <div className="top-actions">
        {isCanvas && (
          <button className="icon-btn" onClick={goHome} title="返回画布列表">
            <Icon name="chevronLeft" size={16} /> 列表
          </button>
        )}
        {isCanvas && (
          <button className="icon-btn" onClick={saveWf} title="保存工作流"><Icon name="save" size={16} /> 保存</button>
        )}
        {isCanvas && (
          <button className="icon-btn" onClick={exportProject} title="导出 JSON"><Icon name="download" size={16} /> 导出</button>
        )}
        {isCanvas && (
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="导入 JSON"><Icon name="upload" size={16} /> 导入</button>
        )}
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImport} />
        {projTip && <span className="proj-tip">{projTip}</span>}
        <button className="icon-btn" onClick={() => setConfigOpen(true)} title="ComfyUI 配置">
          <Icon name="settings" size={16} /> 配置
        </button>
        {isCanvas && (
          <button className="icon-btn" onClick={toggleAssetDrawer} title="资产库">
            <Icon name="folderOpen" size={16} /> 资产{assetCount ? ` (${assetCount})` : ''}
          </button>
        )}
      </div>
    </header>
  );
}
