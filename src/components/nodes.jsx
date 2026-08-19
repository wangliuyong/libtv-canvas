import React, { useRef, useState, useMemo, useLayoutEffect, useEffect, Fragment } from 'react';
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
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const assets = useStore((s) => s.assets);
  const def = getTool(data.tool);
  if (!def) return <div className="lnode">未知工具</div>;
  const status = data.status || 'idle';
  const statusText = { idle: '', running: '生成中', success: '完成', error: '失败' }[status] || '';
  const hasPrompt = def.inputs.some((i) => i.key === 'prompt');
  const promptRef = useRef(null);
  const [mention, setMention] = useState(null); // { open, atPos, endPos, value, items }

  // 提示词框高度自适应：每次渲染按当前值重算（内容撑高，上限 160px），并监听宽度变化（节点缩放）
  const resizePrompt = () => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };
  useLayoutEffect(resizePrompt);
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    const ro = new ResizeObserver(resizePrompt);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // @ 可选项：已连线的图片/音频优先 + 资产库兜底（与运行时 resolveAtRefs 的匹配来源一致）
  const mentionItems = useMemo(() => {
    const out = [];
    const seen = new Set();
    const push = (label, media) => {
      if (!label || seen.has(label)) return;
      seen.add(label);
      out.push({ label, media });
    };
    edges.filter((e) => e.target === id).forEach((e) => {
      const src = nodes.find((n) => n.id === e.source);
      if (!src) return;
      if (src.type === 'asset' && (src.data.kind === 'image' || src.data.kind === 'audio')) {
        push(src.data.filename, src.data.kind);
      } else if (src.type === 'tool' && src.data.result?.assets) {
        src.data.result.assets.forEach((a) => { if (a.media === 'image' || a.media === 'audio') push(a.filename, a.media); });
      }
    });
    assets.forEach((a) => { if (a.media === 'image' || a.media === 'audio') push(a.filename, a.media); });
    return out;
  }, [nodes, edges, assets, id]);

  const handlePromptChange = (e) => {
    const el = e.target;
    const value = el.value;
    updateNodeData(id, { refs: { ...(data.refs || {}), prompt: value } });
    resizePrompt();
    requestAnimationFrame(resizePrompt); // 兜底：等 DOM 完全稳定后再重算高度
    // 用最后一个 @ 及之后是否有分隔符判断是否处于「@token」输入状态（不依赖光标位置，更稳）
    const lastAt = value.lastIndexOf('@');
    if (lastAt >= 0) {
      const tail = value.slice(lastAt + 1);
      if (!/[\s,，。；;\n]/.test(tail)) {
        const q = tail.toLowerCase();
        setMention({ open: true, atPos: lastAt, endPos: value.length, value, items: mentionItems.filter((u) => !q || u.label.toLowerCase().includes(q)) });
        return;
      }
    }
    setMention((m) => (m ? { ...m, open: false } : m));
  };

  const insertMention = (item) => {
    if (!mention) return;
    const { atPos, endPos, value } = mention;
    const next = value.slice(0, atPos) + '@' + item.label + ' ' + value.slice(endPos);
    updateNodeData(id, { refs: { ...(data.refs || {}), prompt: next } });
    setMention(null);
    requestAnimationFrame(() => {
      const el = promptRef.current;
      if (el) {
        el.focus();
        const pos = atPos + 1 + item.label.length + 1;
        el.setSelectionRange(pos, pos);
        resizePrompt();
      }
    });
  };

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={200} minHeight={92} />
      <div className={'lnode tool ' + (selected ? 'sel' : '')}>
      <div className="lnode-h"><Icon name={def.id} /><span className="node-title">{data.label}</span><span className="badge" title={statusText}><span className={'sdot ' + status} /></span>{selected && <button className="node-reset" title="重置尺寸" onMouseDown={(e) => e.stopPropagation()} onClick={() => resetNodeSize(id)}><Icon name="maximize" size={12} /></button>}</div>
      <div className="tn-desc">{def.desc}</div>

      {/* 节点内直接输入提示词（含 prompt 输入的工具），输入 @ 可选已连线的图片/声音 */}
      {hasPrompt && (
        <div className="tn-prompt-wrap">
          <textarea
            ref={promptRef}
            className="tn-prompt"
            rows={2}
            placeholder="提示词（输入 @ 选择已连线的图片/声音）"
            value={data.refs?.prompt || ''}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={handlePromptChange}
            onKeyDown={(e) => { if (e.key === 'Escape') setMention(null); }}
          />
          {mention?.open && mention.items.length > 0 && (
            <div className="mention-panel">
              {mention.items.map((it) => (
                <button
                  key={it.label}
                  className="mention-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertMention(it)}
                >
                  <Icon name={it.media} size={13} /> <span>{it.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button className="run" disabled={status === 'running'} onClick={() => runNode(id)} title={status === 'running' ? '生成中…' : '运行'}>
        {status === 'running' ? <Icon name="loader" size={14} /> : <><Icon name="play" size={14} /> 运行</>}
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
