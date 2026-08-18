import React, { useState, useEffect } from 'react';
import { useStore } from '../store.js';
import Icon from './icons.jsx';

const PAGE_SIZE = 12; // 远程列表每页条数

export default function AssetPanel() {
  const assets = useStore((s) => s.assets);
  const addAssetNode = useStore((s) => s.addAssetNode);
  const updateNodeData = useStore((s) => s.updateNodeData);
  const fetchRemoteList = useStore((s) => s.fetchRemoteList);
  const [tab, setTab] = useState('local');
  const [cat, setCat] = useState('all'); // all | image | video
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState(null); // 资产预览：{ filename, url, media, type, subfolder }

  // Esc 关闭预览
  useEffect(() => {
    if (!preview) return;
    const onKey = (e) => { if (e.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const local = assets.filter((a) => a.source !== 'remote');
  // 远程：按完成时间倒序（后端已排序，这里再保底一次，兼容本地运行产出的 ts）
  const remote = assets
    .filter((a) => a.source === 'remote')
    .slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const base = tab === 'local' ? local : remote;
  const imgCount = base.filter((a) => a.media === 'image').length;
  const vidCount = base.filter((a) => a.media === 'video').length;
  const audCount = base.filter((a) => a.media === 'audio').length;

  // 先按分类筛选，再分页
  const list = cat === 'all' ? base : base.filter((a) => a.media === cat);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const pageItems = tab === 'remote' ? list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : list;

  const refresh = async () => {
    setRefreshing(true);
    try { await fetchRemoteList(); } finally { setRefreshing(false); }
  };

  const openRemote = () => { setTab('remote'); setPage(1); refresh(); };
  const pickCat = (c) => { setCat(c); setPage(1); };

  const insert = (a) => {
    const id = addAssetNode(a.media || 'image');
    const qs = new URLSearchParams({ filename: a.filename, type: a.type || 'output' });
    if (a.subfolder) qs.set('subfolder', a.subfolder);
    const assetUrl = a.url || `/api/view?${qs}`;
    updateNodeData(id, { filename: a.filename, subfolder: a.subfolder || '', type: a.type || 'output', assetUrl, label: a.filename });
  };

  const openPreview = (a) => {
    const qs = new URLSearchParams({ filename: a.filename, type: a.type || 'output' });
    if (a.subfolder) qs.set('subfolder', a.subfolder);
    setPreview({ ...a, url: a.url || `/api/view?${qs}` });
  };

  return (
    <div className="assets">
      <div className="asset-tabs">
        <button className={'asset-tab' + (tab === 'local' ? ' on' : '')} onClick={() => setTab('local')}>
          本地 <span className="tcount">{local.length}</span>
        </button>
        <button className={'asset-tab' + (tab === 'remote' ? ' on' : '')} onClick={openRemote}>
          远程 <span className="tcount">{remote.length}</span>
        </button>
        {tab === 'remote' && (
          <button className={'asset-refresh' + (refreshing ? ' spinning' : '')} onClick={refresh} title="刷新远程图库">
            <Icon name="refreshCw" size={13} />
          </button>
        )}
      </div>

      <div className="asset-cats">
        <button className={'cat' + (cat === 'all' ? ' on' : '')} onClick={() => pickCat('all')}>
          全部 <span className="ccount">{base.length}</span>
        </button>
        <button className={'cat' + (cat === 'image' ? ' on' : '')} onClick={() => pickCat('image')}>
          图片 <span className="ccount">{imgCount}</span>
        </button>
        <button className={'cat' + (cat === 'video' ? ' on' : '')} onClick={() => pickCat('video')}>
          视频 <span className="ccount">{vidCount}</span>
        </button>
        <button className={'cat' + (cat === 'audio' ? ' on' : '')} onClick={() => pickCat('audio')}>
          音频 <span className="ccount">{audCount}</span>
        </button>
      </div>

      <div className="assets-scroll">
        {list.length === 0 ? (
          <div className="empty">
            {tab === 'local'
              ? '本地资产：从节点或属性面板上传文件后，会汇集到这里'
              : '远程资产：运行工具节点 / 刷新远程图库后，会汇集到这里'}
          </div>
        ) : (
          <div className="assets-grid">
            {pageItems.map((a, i) => (
              <div key={(a.filename || i) + '_' + i} className="asset-card">
                <div
                  className={'asset-media' + (a.media === 'audio' ? ' audio' : '')}
                  onDoubleClick={() => insert(a)}
                  title="双击插入到画布"
                >
                  {a.media === 'image' ? <img src={a.url} alt="" />
                    : a.media === 'video' ? <video src={a.url} muted preload="metadata" />
                    : <audio src={a.url} controls />}
                  <button
                    className="asset-prev-btn"
                    title="预览"
                    onClick={(e) => { e.stopPropagation(); openPreview(a); }}
                  >
                    <Icon name="maximize" size={14} />
                  </button>
                </div>
                <div className="asset-name">{a.filename}</div>
                <div className="asset-hint">双击插入画布 · 点图标预览</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 资产预览弹层 */}
      {preview && (
        <div className="asset-preview-overlay" onClick={() => setPreview(null)}>
          <div className="asset-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="apm-h">
              <span className="apm-name">{preview.filename}</span>
              <button className="drawer-close" onClick={() => setPreview(null)} title="关闭"><Icon name="x" size={16} /></button>
            </div>
            <div className="apm-body">
              {preview.media === 'image' ? <img src={preview.url} alt="" />
                : preview.media === 'video' ? <video src={preview.url} controls autoPlay />
                : (
                  <div className="apm-audio">
                    <Icon name="audio" size={42} />
                    <audio src={preview.url} controls autoPlay style={{ width: '100%', maxWidth: 460 }} />
                  </div>
                )}
            </div>
            <div className="apm-actions">
              <button className="btn primary" onClick={() => { insert(preview); setPreview(null); }}>插入到画布</button>
            </div>
          </div>
        </div>
      )}

      {pages > 1 && (
        <div className="pager">
          <button className="pg-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <Icon name="chevronLeft" size={14} /> 上一页
          </button>
          <span className="pg-info">{page} / {pages}（共 {list.length}）</span>
          <button className="pg-btn" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
            下一页 <Icon name="chevronRight" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
