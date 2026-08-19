import React, { useRef, useState, Fragment } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';
import { useStore } from '../store.js';
import { getTool } from '../../server/tools.js';
import Icon from './icons.jsx';

const OUT_TYPE = (kind) => (kind === 'script' ? 'text' : kind);

function AssetNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const addAsset = useStore((s) => s.addAsset);
  const resetNodeSize = useStore((s) => s.resetNodeSize);
  const fileRef = useRef(null);
  const [upErr, setUpErr] = useState('');

  const onUpload = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setUpErr('');
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      const qs = new URLSearchParams({ filename: j.name, type: j.type || 'input' });
      if (j.subfolder) qs.set('subfolder', j.subfolder);
      updateNodeData(id, { filename: j.name, subfolder: j.subfolder || '', type: j.type || 'input', assetUrl: `/api/view?${qs}`, label: f.name });
      addAsset({ filename: j.name, subfolder: j.subfolder || '', type: j.type || 'input', media: data.kind, url: `/api/view?${qs}`, label: f.name, source: 'local' });
    } catch (err) {
      setUpErr('上传失败：' + (err.message || err));
    }
  };

  const outType = OUT_TYPE(data.kind);
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={170} minHeight={60} />
      <div className={'lnode asset ' + (selected ? 'sel' : '')}>
      <div className="lnode-h"><Icon name={data.kind} /><span className="node-title">{data.label}</span>{selected && <button className="node-reset" title="重置尺寸" onMouseDown={(e) => e.stopPropagation()} onClick={() => resetNodeSize(id)}><Icon name="maximize" size={12} /></button>}</div>
      {data.kind === 'text' || data.kind === 'script' ? (
        <textarea className="txt" value={data.text || ''} placeholder={data.kind === 'script' ? '在此写剧本 / 分镜脚本…' : '提示词文本…'}
          onChange={(e) => updateNodeData(id, { text: e.target.value })} />
      ) : (
        <div className="media">
          {data.assetUrl ? (
            data.kind === 'image' ? <img src={data.assetUrl} alt="" />
            : data.kind === 'video' ? <video src={data.assetUrl} controls />
            : <audio src={data.assetUrl} controls />
          ) : <div className="ph">未上传</div>}
          <button className="mini" onClick={() => fileRef.current.click()}>上传</button>
          <input ref={fileRef} type="file" hidden onChange={onUpload} />
          {upErr && <div className="err" style={{ marginTop: 6 }}>{upErr}</div>}
        </div>
      )}
      <Handle type="source" position={Position.Right} id={outType} style={{ background: 'var(--node-asset)' }} />
      </div>
    </>
  );
}

function ToolNode({ id, data, selected }) {
  const runNode = useStore((s) => s.runNode);
  const updateNodeData = useStore((s) => s.updateNodeData);
  const resetNodeSize = useStore((s) => s.resetNodeSize);
  const def = getTool(data.tool);
  if (!def) return <div className="lnode">未知工具</div>;
  const status = data.status || 'idle';
  const statusText = { idle: '', running: '生成中', success: '完成', error: '失败' }[status] || '';

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={200} minHeight={92} />
      <div className={'lnode tool ' + (selected ? 'sel' : '')}>
      <div className="lnode-h"><Icon name={def.id} /><span className="node-title">{data.label}</span><span className="badge"><span className={'sdot ' + status} />{statusText}</span>{selected && <button className="node-reset" title="重置尺寸" onMouseDown={(e) => e.stopPropagation()} onClick={() => resetNodeSize(id)}><Icon name="maximize" size={12} /></button>}</div>
      <div className="tn-desc">{def.desc}</div>

      {/* 节点内直接输入提示词（含 prompt 输入的工具），支持 @ 引用资产库图片/声音 */}
      {def.inputs.some((i) => i.key === 'prompt') && (
        <textarea
          className="tn-prompt"
          rows={2}
          placeholder="提示词（可用 @引用资产库中的 图片/声音）"
          value={data.refs?.prompt || ''}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => updateNodeData(id, { refs: { ...(data.refs || {}), prompt: e.target.value } })}
        />
      )}

      <button className="run" disabled={status === 'running'} onClick={() => runNode(id)}>
        {status === 'running' ? '生成中…' : <><Icon name="play" size={14} /> 运行</>}
      </button>

      {/* 输入把手：直接贴在卡片左边框中心线，多输入沿边框垂直均布 */}
      {def.inputs.map((inp, i) => {
        const n = def.inputs.length;
        const top = ((i + 1) / (n + 1)) * 100;
        return (
          <Fragment key={inp.key}>
            <Handle
              type="target"
              position={Position.Left}
              id={'IN:' + inp.key}
              style={{ background: 'var(--handle-in)', top: `${top}%` }}
            />
            <span className="io-label" style={{ top: `${top}%` }}>
              {inp.label}{inp.required ? ' *' : ''}
            </span>
          </Fragment>
        );
      })}

      {/* 输出把手 */}
      {def.outputs.map((o) => (
        <Handle key={o} type="source" position={Position.Right} id={o} style={{ background: 'var(--node-tool)' }} />
      ))}

      {data.result?.assets?.length > 0 && (
        <div className="result">
          {data.result.assets.slice(0, 4).map((a, i) => (
            <a key={i} href={a.url} target="_blank" rel="noreferrer">
              {a.media === 'image' ? <img src={a.url} alt="" />
                : a.media === 'video' ? <video src={a.url} muted />
                : <Icon name="audio" size={18} />}
            </a>
          ))}
        </div>
      )}
      {data.error && <div className="err">{data.error}</div>}
      </div>
    </>
  );
}

function GroupNode({ data, selected }) {
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={180} minHeight={120} />
      <div className="group-node">
        <span className="group-label">{data.label || '分镜组'}</span>
      </div>
    </>
  );
}

export { AssetNode, ToolNode, GroupNode };
