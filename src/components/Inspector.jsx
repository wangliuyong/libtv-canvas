import React, { useRef, useState } from 'react';
import { useStore } from '../store.js';
import { getTool } from '../../server/tools.js';
import Icon from './icons.jsx';

// 图片工具（t2i/ref2i/char3view 等）画幅与长边分辨率
const IMG_ASPECTS = [
  { id: '16:9', w: 16, h: 9 },
  { id: '9:16', w: 9, h: 16 },
  { id: '1:1', w: 1, h: 1 },
  { id: '4:3', w: 4, h: 3 },
];
const IMG_RESS = { '1K': 1280, '2K': 2560, '4K': 3840 };

// MiniMax H3 开源版视频规格：短边默认 768px（上限 768×1344，最低 384p，256p 失败），分辨率网格按 32 对齐
const VID_ASPECTS = [
  { id: '21:9', w: 21, h: 9 },
  { id: '16:9', w: 16, h: 9 },
  { id: '4:3', w: 4, h: 3 },
  { id: '1:1', w: 1, h: 1 },
  { id: '3:4', w: 3, h: 4 },
  { id: '9:16', w: 9, h: 16 },
];
const VID_RESS = { '768p 全质': 768, '640p': 640, '512p': 512, '384p 快速': 384 };
const H3_ALIGN = 32;
// MiniMax H3 帧数硬规则：帧数落在 17k+5 网格（24fps，训练区间 124~362 帧 ≈ 5.17~15.08s）
const DUR_OPTS = ['5', '6', '8', '10', '12', '15'];
function h3Frames(sec) {
  const s = Math.max(4, Math.min(15, Math.round(Number(sec) || 8)));
  const n = Math.ceil((s * 24 - 5) / 17) * 17 + 5;
  return Math.max(124, Math.min(362, n));
}

// 由画幅 + 分辨率推导像素宽高：图片=长边取分辨率；视频=短边取分辨率（32 对齐、384~1344 区间）
function computeWH(aspectId, res, isVideo) {
  if (isVideo) {
    const a = VID_ASPECTS.find((x) => x.id === aspectId) || VID_ASPECTS[0];
    const base = VID_RESS[res] || 768;
    const align = (v) => Math.max(384, Math.min(1344, Math.round(v / H3_ALIGN) * H3_ALIGN));
    const ratio = a.w / a.h;
    if (ratio >= 1) return { w: align(base * ratio), h: base };
    return { w: base, h: align(base / ratio) };
  }
  const a = IMG_ASPECTS.find((x) => x.id === aspectId) || IMG_ASPECTS[0];
  const long = IMG_RESS[res] || 1920;
  let w, h;
  if (a.w >= a.h) { w = long; h = Math.round(long * a.h / a.w); }
  else { h = long; w = Math.round(long * a.w / a.h); }
  return { w, h };
}

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
  const assets = useStore((s) => s.assets);
  const updateNodeData = useStore((s) => s.updateNodeData);
  const addAsset = useStore((s) => s.addAsset);
  const runNode = useStore((s) => s.runNode);
  const deleteNode = useStore((s) => s.deleteNode);
  const resetNodeSize = useStore((s) => s.resetNodeSize);
  const toggleAssetDrawer = useStore((s) => s.toggleAssetDrawer);
  const fileRef = useRef(null);
  const [libOpen, setLibOpen] = useState(null); // 当前打开资产库选择器的输入 key

  if (!node) return <div className="empty">选中一个节点以编辑属性</div>;

  const setRef = (key, val) => {
    const refs = { ...(node.data.refs || {}) };
    if (val == null) delete refs[key];
    else refs[key] = val;
    updateNodeData(node.id, { refs });
  };

  // 多图输入：在数组末尾追加一张参考；multi 时 refs[key] 始终是数组
  const pushRef = (key, val) => {
    const refs = { ...(node.data.refs || {}) };
    const arr = Array.isArray(refs[key]) ? refs[key] : [];
    refs[key] = [...arr, val];
    updateNodeData(node.id, { refs });
  };
  const removeRefAt = (key, idx) => {
    const refs = { ...(node.data.refs || {}) };
    const arr = Array.isArray(refs[key]) ? refs[key] : [];
    refs[key] = arr.filter((_, i) => i !== idx);
    if (refs[key].length === 0) delete refs[key];
    updateNodeData(node.id, { refs });
  };

  const onUpload = async (e, key, mediaType, multi) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      const assetUrl = `/api/view?${new URLSearchParams({ filename: j.name, type: j.type || mediaType, ...(j.subfolder ? { subfolder: j.subfolder } : {}) })}`;
      const val = { reupload: { filename: j.name, subfolder: j.subfolder || '', type: j.type || mediaType }, assetUrl, label: f.name };
      if (key) { if (multi) pushRef(key, val); else setRef(key, val); }
      else updateNodeData(node.id, { filename: j.name, subfolder: j.subfolder || '', type: j.type || mediaType, assetUrl, label: f.name });
      addAsset({ filename: j.name, subfolder: j.subfolder || '', type: j.type || mediaType, media: mediaType, url: assetUrl, label: f.name, source: 'local' });
    } catch (err) {
      updateNodeData(node.id, { error: '上传失败：' + (err.message || err) });
    }
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
            <input ref={fileRef} type="file" hidden onChange={(e) => onUpload(e, null, d.kind)} />
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
        <button className="btn-outline" onClick={() => resetNodeSize(node.id)}>重置尺寸</button>
        <button className="del" onClick={() => deleteNode(node.id)}>删除节点</button>
      </div>
    );
  }

  const def = getTool(node.data.tool);
  const params = node.data.params || {};
  const refs = node.data.refs || {};
  const isGen = (def.outputs || []).some((o) => o === 'image' || o === 'video');
  const isVideo = (def.outputs || []).includes('video');
  const aspects = isVideo ? VID_ASPECTS : IMG_ASPECTS;
  const ress = isVideo ? VID_RESS : IMG_RESS;
  const defRes = isVideo ? '768p 全质' : '2K';

  const applyScreen = (aspectId, res) => {
    const { w, h } = computeWH(aspectId, res, isVideo);
    updateNodeData(node.id, { params: { ...params, _aspect: aspectId, _res: res, width: w, height: h } });
  };

  return (
    <div className="insp">
      <div className="insp-h"><Icon name={def.id} /> {def.name}</div>
      <div className="desc">{def.desc}</div>

      {/* 参考图 / 提示词 输入槽 */}
      {(def.inputs || []).length > 0 && (
        <div className="refs">
          <div className="refs-h">输入参考</div>
          {def.inputs.map((inp) => {
            const ref = refs[inp.key];
            const isText = inp.type === 'text';
            return (
              <div className="ref-slot" key={inp.key}>
                <div className="ref-top">
                  <span className="ref-name">{inp.label}{inp.required ? ' *' : ''}</span>
                  <span className="ref-type">{inp.type}</span>
                </div>
                {isText ? (
                  <textarea rows={3} placeholder="提示词 / 文本…" value={typeof ref === 'string' ? ref : ''}
                    onChange={(e) => setRef(inp.key, e.target.value)} />
                ) : (
                  <>
                    {inp.multi && Array.isArray(ref) && ref.length > 0 && (
                      <div className="ref-multi">
                        {ref.map((r, idx) => (
                          <div className="ref-thumb" key={idx}>
                            {inp.type === 'video' ? <video src={r.assetUrl} muted />
                              : inp.type === 'audio' ? <audio src={r.assetUrl} controls />
                              : <img src={r.assetUrl} alt="" />}
                            <button className="mini ghost" onClick={() => removeRefAt(inp.key, idx)}>移除</button>
                            <span className="rt-idx">{idx + 1}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {!inp.multi && (
                      <div className="ref-media">
                        {ref?.assetUrl ? (
                          inp.type === 'video' ? <video src={ref.assetUrl} muted />
                            : inp.type === 'audio' ? <audio src={ref.assetUrl} controls />
                            : <img src={ref.assetUrl} alt="" />
                        ) : <div className="ph">未设置参考</div>}
                      </div>
                    )}
                    <div className="ref-actions">
                      <label className="mini">上传<input type="file" hidden onChange={(e) => onUpload(e, inp.key, inp.type, inp.multi)} /></label>
                      <button className="mini" onClick={() => { setLibOpen(libOpen === inp.key ? null : inp.key); if (libOpen !== inp.key) toggleAssetDrawer(); }}>{inp.multi ? '从资产库添加' : '从资产库选'}</button>
                      {!inp.multi && ref && <button className="mini ghost" onClick={() => setRef(inp.key, null)}>清除</button>}
                      {inp.multi && Array.isArray(ref) && ref.length > 0 && <button className="mini ghost" onClick={() => setRef(inp.key, [])}>清空</button>}
                    </div>
                    {libOpen === inp.key && (
                      <div className="lib-pick">
                        {assets.length === 0 && <div className="ph">资产库为空，先运行上游节点或上传</div>}
                        {assets.filter((a) => a.media === inp.type || !a.media).slice(0, 12).map((a, i) => (
                          <button key={i} className="lib-item" onClick={() => {
                            const val = { reupload: { filename: a.filename, subfolder: a.subfolder, type: a.type }, assetUrl: a.url, label: a.filename };
                            if (inp.multi) pushRef(inp.key, val); else setRef(inp.key, val);
                            setLibOpen(null);
                          }}>
                            <img src={a.url} alt="" /><span>{a.filename}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 画面设置：画幅 / 分辨率 / 画质 / 张数（生成类工具） */}
      {isGen && (
        <div className="screen">
          <div className="refs-h">画面设置{isVideo && <span className="h3-tag">MiniMax H3 规格</span>}</div>
          <label className="pf"><span>画幅 / 视频比例</span>
            <select value={params._aspect || '16:9'} onChange={(e) => applyScreen(e.target.value, params._res || defRes)}>
              {aspects.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
            </select>
          </label>
          <label className="pf"><span>分辨率</span>
            <select value={params._res || defRes} onChange={(e) => applyScreen(params._aspect || '16:9', e.target.value)}>
              {Object.keys(ress).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {!isVideo && (
            <label className="pf"><span>画质</span>
              <select value={params._quality || 'standard'} onChange={(e) => updateNodeData(node.id, { params: { ...params, _quality: e.target.value, steps: e.target.value === 'hd' ? 20 : 8 } })}>
                <option value="standard">标准</option>
                <option value="hd">高清</option>
              </select>
            </label>
          )}
          {isVideo && (
            <>
              <label className="pf"><span>时长(秒)</span>
                <select value={String(params.duration ?? '8')} onChange={(e) => updateNodeData(node.id, { params: { ...params, duration: e.target.value } })}>
                  {DUR_OPTS.map((d) => <option key={d} value={d}>{d} 秒</option>)}
                </select>
              </label>
              <label className="pf"><span>步数(加速)</span>
                <input type="number" min={1} max={40} value={params.steps ?? 8}
                  onChange={(e) => updateNodeData(node.id, { params: { ...params, steps: Math.max(1, Number(e.target.value) || 8) } })} />
              </label>
            </>
          )}
          {!isVideo && (
            <label className="pf"><span>张数</span>
              <input type="number" min={1} max={4} value={params._count || 1} onChange={(e) => updateNodeData(node.id, { params: { ...params, _count: Math.max(1, Number(e.target.value) || 1) } })} />
            </label>
          )}
          <div className="wh-hint">
            {isVideo
              ? `输出 ${params.width || computeWH(params._aspect || '16:9', params._res || defRes, true).w} × ${params.height || computeWH(params._aspect || '16:9', params._res || defRes, true).h} · 时长 ${params.duration || '8'} 秒 → ${h3Frames(params.duration || '8')} 帧（17k+5 网格）`
              : `输出 ${params.width || computeWH(params._aspect || '16:9', params._res || defRes, false).w} × ${params.height || computeWH(params._aspect || '16:9', params._res || defRes, false).h}`}
          </div>
        </div>
      )}

      {/* 其余参数 */}
      <div className="params">
        <div className="refs-h">参数</div>
        {(def.params || []).filter((p) => !['width', 'height', 'steps'].includes(p.key)).map((p) => (
          <ParamField key={p.key} p={p} value={params[p.key]} models={models}
            onChange={(v) => updateNodeData(node.id, { params: { ...params, [p.key]: v } })} />
        ))}
      </div>

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
      <button className="btn-outline" onClick={() => resetNodeSize(node.id)}>重置尺寸</button>
      <button className="del" onClick={() => deleteNode(node.id)}>删除节点</button>
    </div>
  );
}
