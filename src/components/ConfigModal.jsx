import React, { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import Icon from './icons.jsx';

export default function ConfigModal({ open, onClose }) {
  const fetchModels = useStore((s) => s.fetchModels);
  const fetchRemoteList = useStore((s) => s.fetchRemoteList);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr(''); setSaving(false);
    fetch('/api/config')
      .then((r) => r.json())
      .then((j) => setUrl(j.comfyUrl || ''))
      .catch(() => setUrl(''));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const r = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comfyUrl: url }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '保存失败');
      setUrl(j.comfyUrl);
      // 重新拉取，使新地址立即作用于模型列表与远程图库
      fetchModels();
      fetchRemoteList();
      onClose();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>ComfyUI 配置</span>
          <button className="modal-close" onClick={onClose} title="关闭 (Esc)"><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body cfg-body">
          <label className="cfg-label">ComfyUI 远程地址</label>
          <input
            className="cfg-input"
            value={url}
            placeholder="http://host:port"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            autoFocus
          />
          <p className="cfg-desc">
            修改后即时生效，并保存到本地 server/config.local.json（已被 gitignore，不会入库）。
            地址须以 http:// 或 https:// 开头。
          </p>
          {err && <div className="cfg-err">{err}</div>}
          <div className="cfg-actions">
            <button className="btn" onClick={onClose}>取消</button>
            <button className="btn primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
