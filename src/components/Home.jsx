import React, { useEffect, useState } from 'react';
import Icon from './icons.jsx';
import { useStore, TEMPLATE_LIST } from '../store.js';
import AssetPanel from './AssetPanel.jsx';

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function Home() {
  const canvases = useStore((s) => s.canvases);
  const loadCanvases = useStore((s) => s.loadCanvases);
  const createCanvas = useStore((s) => s.createCanvas);
  const openCanvas = useStore((s) => s.openCanvas);
  const deleteCanvas = useStore((s) => s.deleteCanvas);
  const renameCanvas = useStore((s) => s.renameCanvas);
  const setProjTip = useStore((s) => s.setProjTip);
  const fetchRemoteList = useStore((s) => s.fetchRemoteList);

  const [tab, setTab] = useState('canvases'); // canvases | assets
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState('blank');

  useEffect(() => {
    loadCanvases();
    fetchRemoteList(); // 首页资产库也需要汇总远程产出
  }, [loadCanvases, fetchRemoteList]);

  const handleCreate = () => {
    createCanvas(newName.trim(), newTemplate);
    setNewName('');
    setNewTemplate('blank');
    setCreating(false);
    // createCanvas 已把新画布设为 current，自动进入画布页
  };

  const handleDelete = (e, c) => {
    e.stopPropagation();
    if (!confirm(`确定删除画布「${c.name}」？此操作不可撤销。`)) return;
    deleteCanvas(c.id);
    setProjTip(`已删除「${c.name}」`);
  };

  return (
    <div className={'home' + (tab === 'assets' ? ' no-scroll' : '')}>
      <div className={'home-inner' + (tab === 'assets' ? ' fill' : '')}>
        <div className="home-head">
          <div>
            <h1>我的工作台</h1>
            <p className="home-sub">创建并管理你的 AI 视频创作画布与资产</p>
          </div>
          <span className="home-count">{canvases.length} 个画布</span>
        </div>

        <div className="home-tabs">
          <button className={'home-tab' + (tab === 'canvases' ? ' on' : '')} onClick={() => setTab('canvases')}>
            <Icon name="film" size={14} /> 我的画布
          </button>
          <button className={'home-tab' + (tab === 'assets' ? ' on' : '')} onClick={() => { setTab('assets'); fetchRemoteList(); }}>
            <Icon name="folderOpen" size={14} /> 资产库
          </button>
        </div>

        {tab === 'canvases' ? (
        <div className="canvas-grid">
          {/* 新建画布入口 */}
          <div
            className={'canvas-card new' + (creating ? ' creating' : '')}
            onClick={() => !creating && setCreating(true)}
          >
            {creating ? (
              <div className="new-form" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  className="new-input"
                  placeholder="画布名称"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
                />
                <label className="new-tpl">
                  <span>模板</span>
                  <select value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}>
                    {TEMPLATE_LIST.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} — {t.desc}</option>
                    ))}
                  </select>
                </label>
                <div className="new-actions">
                  <button className="btn primary" onClick={handleCreate}>创建</button>
                  <button className="btn" onClick={() => { setCreating(false); setNewName(''); }}>取消</button>
                </div>
              </div>
            ) : (
              <div className="new-placeholder">
                <Icon name="plus" size={26} />
                <span>新建画布</span>
              </div>
            )}
          </div>

          {/* 画布卡片 */}
          {canvases.map((c) => (
            <CanvasCard
              key={c.id}
              canvas={c}
              onOpen={() => openCanvas(c.id)}
              onDelete={(e) => handleDelete(e, c)}
              onRename={(name) => renameCanvas(c.id, name)}
            />
          ))}

          {canvases.length === 0 && !creating && (
            <div className="home-empty">还没有画布，点击左上角「新建画布」开始创作吧。</div>
          )}
        </div>
        ) : (
          <div className="home-assets">
            <AssetPanel insertable={false} virtual />
          </div>
        )}
      </div>
    </div>
  );
}

function CanvasCard({ canvas, onOpen, onDelete, onRename }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(canvas.name);

  useEffect(() => { setName(canvas.name); }, [canvas.name]);

  const commit = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== canvas.name) onRename(name.trim());
    else setName(canvas.name);
  };

  return (
    <div className="canvas-card" onClick={onOpen}>
      <div className="cc-thumb">
        <Icon name="film" size={30} />
      </div>
      <div className="cc-body">
        {editing ? (
          <input
            className="cc-name-input"
            autoFocus
            value={name}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(canvas.name); setEditing(false); } }}
          />
        ) : (
          <div className="cc-name" onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}>{canvas.name}</div>
        )}
        <div className="cc-meta">
          <span>{canvas.nodeCount} 个节点</span>
          <span className="cc-dot">·</span>
          <span>{fmtDate(canvas.updatedAt)}</span>
        </div>
      </div>
      <div className="cc-actions" onClick={(e) => e.stopPropagation()}>
        <button className="cc-btn" title="重命名" onClick={() => setEditing(true)}><Icon name="edit" size={15} /></button>
        <button className="cc-btn danger" title="删除" onClick={onDelete}><Icon name="trash" size={15} /></button>
      </div>
    </div>
  );
}
