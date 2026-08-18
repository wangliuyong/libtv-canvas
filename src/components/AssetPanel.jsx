import React from 'react';
import { useStore } from '../store.js';

export default function AssetPanel() {
  const assets = useStore((s) => s.assets);
  const addAssetNode = useStore((s) => s.addAssetNode);
  const updateNodeData = useStore((s) => s.updateNodeData);

  const insert = (a) => {
    const id = addAssetNode('image');
    const qs = new URLSearchParams({ filename: a.filename, type: a.type || 'output' });
    if (a.subfolder) qs.set('subfolder', a.subfolder);
    updateNodeData(id, { filename: a.filename, subfolder: a.subfolder || '', type: a.type || 'output', assetUrl: `/api/view?${qs}`, label: a.filename });
  };

  if (!assets.length) return <div className="empty">运行工具节点后，产出会汇集到这里</div>;
  return (
    <div className="assets">
      <div className="assets-h">资产库（{assets.length}）</div>
      <div className="assets-grid">
        {assets.map((a, i) => (
          <div key={i} className="asset-card">
            {a.media === 'image' ? <img src={a.url} alt="" onClick={() => insert(a)} title="点击插入为图片节点" />
              : a.media === 'video' ? <video src={a.url} muted onClick={() => insert(a)} />
              : <audio src={a.url} controls />}
            <div className="asset-name">{a.filename}</div>
            <button className="mini" onClick={() => insert(a)}>插入画布</button>
          </div>
        ))}
      </div>
    </div>
  );
}
