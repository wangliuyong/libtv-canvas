import React, { useRef } from 'react';
import { useStore } from '../store.js';
import { getTool } from '../../server/tools.js';
import Icon from './icons.jsx';

function ParamField({ p, value, onChange, models }) {
  if (p.type === 'select') {
    let opts = p.options || [];
    if (p.model === 'checkpoints') opts = models?.checkpoints || [];
    if (p.model === 'upscale') opts = models?.upscale || [];
    return (
      <label className="pf">
        <span>{p.label}</span>
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  if (p.type === 'number') {
    return (
      <label className="pf">
        <span>{p.label}</span>
        <input type="number" value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} />
      </label>
    );
  }
  return (
    <label className="pf">
      <span>{p.label}</span>
      <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function Inspector({ nodeId } = {}) {
  const selectedId = useStore((s) => s.selectedId);
  const id = nodeId ?? selectedId;
  const node = useStore((s) => s.nodes.find((n) => n.id === id));
  const models = useStore((s) => s.models);
  const updateNodeData = useStore((s) => s.updateNodeData);
  const runNode = useStore((s) => s.runNode);
  const deleteNode = useStore((s) => s.deleteNode);
  const fileRef = useRef(null);

  if (!node) return <div className="empty">选中一个节点以编辑属性</div>;

  const onUpload = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    const j = await r.json();
    const qs = new URLSearchParams({ filename: j.name, type: j.type || 'input' });
    if (j.subfolder) qs.set('subfolder', j.subfolder);
    updateNodeData(node.id, { filename: j.name, subfolder: j.subfolder || '', type: j.type || 'input', assetUrl: `/api/view?${qs}`, label: f.name });
  };

  if (node.data.kind !== 'tool') {
    const d = node.data;
    return (
      <div className="insp">
        <div className="insp-h">{d.label} 节点</div>
        <label className="pf"><span>名称</span><input value={d.label} onChange={(e) => updateNodeData(node.id, { label: e.target.value })} /></label>
        {(d.kind === 'text' || d.kind === 'script') ? (
          <label className="pf col"><span>内容</span>
            <textarea rows={6} value={d.text || ''} onChange={(e) => updateNodeData(node.id, { text: e.target.value })} />
          </label>
        ) : (
          <>
            <button className="run" onClick={() => fileRef.current.click()}>上传媒体文件</button>
            <input ref={fileRef} type="file" hidden onChange={onUpload} />
            {d.assetUrl && (
              <div className="prev">
                {d.kind === 'image' ? <img src={d.assetUrl} alt="" />
                  : d.kind === 'video' ? <video src={d.assetUrl} controls />
                  : <audio src={d.assetUrl} controls />}
              </div>
            )}
            <div className="fname">{d.filename}</div>
          </>
        )}
        <button className="del" onClick={() => deleteNode(node.id)}>删除节点</button>
      </div>
    );
  }

  const def = getTool(node.data.tool);
  const params = node.data.params || {};
  return (
    <div className="insp">
      <div className="insp-h"><Icon name={def.id} /> {def.name}</div>
      <div className="desc">{def.desc}</div>
      {(def.params || []).map((p) => (
        <ParamField key={p.key} p={p} value={params[p.key]} models={models}
          onChange={(v) => updateNodeData(node.id, { params: { ...params, [p.key]: v } })} />
      ))}
      <button className="run big" disabled={node.data.status === 'running'} onClick={() => runNode(node.id)}>
        {node.data.status === 'running' ? '生成中…' : <><Icon name="play" size={14} /> 运行此节点</>}
      </button>
      {node.data.error && <div className="err">{node.data.error}</div>}
      {node.data.result?.assets?.length > 0 && (
        <div className="result-list">
          <div className="rl-h">产出（点击在新标签打开）</div>
          {node.data.result.assets.map((a, i) => (
            <a key={i} href={a.url} target="_blank" rel="noreferrer" className="rl-item">
              {a.media === 'image' ? <img src={a.url} alt="" /> : <span className="rl-media"><Icon name={a.media} size={14} /> {a.filename}</span>}
            </a>
          ))}
        </div>
      )}
      <button className="del" onClick={() => deleteNode(node.id)}>删除节点</button>
    </div>
  );
}
