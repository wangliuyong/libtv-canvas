import React, { useEffect } from 'react';
import Icon from './icons.jsx';

export default function ContextMenu({ menu, onClose }) {
  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    // 延迟一帧再挂监听，避免捕获打开菜单的同一次事件
    const t = setTimeout(() => {
      window.addEventListener('click', close);
      window.addEventListener('contextmenu', close);
    }, 0);
    return () => { clearTimeout(t); window.removeEventListener('click', close); window.removeEventListener('contextmenu', close); };
  }, [menu, onClose]);

  if (!menu) return null;

  const x = Math.min(menu.x, window.innerWidth - 200);
  const y = Math.min(menu.y, window.innerHeight - (menu.items.length * 36 + 12));

  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) => (
        <button
          key={i}
          className={'ctx-item' + (it.danger ? ' danger' : '')}
          onClick={() => { it.onClick(); onClose(); }}
        >
          <Icon name={it.icon} size={15} />
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}
