import React from 'react';
import { useStore } from '../store.js';
import AssetPanel from './AssetPanel.jsx';
import Icon from './icons.jsx';

export default function AssetDrawer() {
  const open = useStore((s) => s.assetDrawerOpen);
  const close = useStore((s) => s.toggleAssetDrawer);

  return (
    <>
      <div className={'drawer-backdrop' + (open ? ' show' : '')} />
      <aside className={'asset-drawer' + (open ? ' open' : '')}>
        <div className="drawer-h">
          <span>资产库</span>
          <button className="drawer-close" onClick={close} title="关闭"><Icon name="x" size={16} /></button>
        </div>
        <div className="drawer-body">
          <AssetPanel />
        </div>
      </aside>
    </>
  );
}
