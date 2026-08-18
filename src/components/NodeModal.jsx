import React, { useEffect } from 'react';
import { useStore } from '../store.js';
import Inspector from './Inspector.jsx';
import Icon from './icons.jsx';

export default function NodeModal() {
  const nodeModalId = useStore((s) => s.nodeModalId);
  const close = useStore((s) => s.closeNodeModal);

  useEffect(() => {
    if (!nodeModalId) return;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodeModalId, close]);

  if (!nodeModalId) return null;

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>属性维护</span>
          <button className="modal-close" onClick={close} title="关闭 (Esc)"><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <Inspector nodeId={nodeModalId} />
        </div>
      </div>
    </div>
  );
}
