import React, { useEffect, useRef, useState } from 'react';
import { useReactFlow } from 'reactflow';
import { useStore } from '../store.js';
import { TOOLS } from '../../server/tools.js';
import Icon from './icons.jsx';

const BASIC = [
  { kind: 'text', label: '文本' },
  { kind: 'script', label: '脚本' },
  { kind: 'image', label: '图片' },
  { kind: 'video', label: '视频' },
  { kind: 'audio', label: '音频' },
];

const CAT_NAME = { image: '图像类', video: '视频类' };

export default function BottomToolbar() {
  const rf = useReactFlow();
  const addAssetNode = useStore((s) => s.addAssetNode);
  const addToolNode = useStore((s) => s.addToolNode);
  const toggleAssetDrawer = useStore((s) => s.toggleAssetDrawer);
  const canvasLocked = useStore((s) => s.canvasLocked);
  const toggleCanvasLock = useStore((s) => s.toggleCanvasLock);
  const fetchRemoteList = useStore((s) => s.fetchRemoteList);
  const [menuOpen, setMenuOpen] = useState(false);
  const barRef = useRef(null);

  const grouped = {};
  TOOLS.forEach((t) => { (grouped[t.cat] = grouped[t.cat] || []).push(t); });

  const addAtCenter = (fn) => {
    const { x, y, zoom } = rf.getViewport();
    const cx = (window.innerWidth / 2 - x) / zoom;
    const cy = (window.innerHeight / 2 - y) / zoom;
    fn(cx, cy);
    setMenuOpen(false);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  // 点击节点列表（含底部工具条容器）之外任意位置 → 收起菜单
  // 捕获阶段监听，避开 React Flow 对画布 mousedown 的 stopPropagation
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (barRef.current && !barRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [menuOpen]);

  return (
    <div className="bottom-bar" ref={barRef}>
      {menuOpen && (
        <div className="add-node-menu">
          <div className="anm-title">添加节点</div>
          <div className="anm-sec">
            {BASIC.map((b) => (
              <button key={b.kind} className="anm-item" data-kind={b.kind} onClick={() => addAtCenter((x, y) => addAssetNode(b.kind, { x, y }))}>
                <Icon name={b.kind} size={16} /> {b.label}
              </button>
            ))}
          </div>
          <div className="anm-divider" />
          <div className="anm-sec">
            {Object.entries(grouped).map(([cat, list]) => (
              <div key={cat}>
                <div className="anm-sub">{CAT_NAME[cat] || cat}</div>
                {list.map((t) => (
                  <button key={t.id} className={'anm-item tool' + (t.scaffold ? ' scaf' : '')} onClick={() => addAtCenter((x, y) => addToolNode(t.id, { x, y }))} title={t.desc}>
                    <Icon name={t.id} size={16} /> {t.name}{t.scaffold ? ' (脚手架)' : ''}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="anm-divider" />
          <div className="anm-sec">
            <button className="anm-item" onClick={() => { toggleAssetDrawer(); setMenuOpen(false); }}>
              <Icon name="folderOpen" size={16} /> 素材库 / 资产
            </button>
            <button className="anm-item" onClick={() => { fetchRemoteList(); toggleAssetDrawer(); setMenuOpen(false); }}>
              <Icon name="refreshCw" size={16} /> 从生成历史选择
            </button>
          </div>
        </div>
      )}

      <div className="bottom-pill">
        <button className="bb-btn" onClick={() => setMenuOpen((v) => !v)} title="添加节点">
          <Icon name="plus" size={18} />
        </button>
        <span className="bb-sep" />
        <button className="bb-btn" onClick={() => rf.zoomIn()} title="放大">
          <Icon name="zoomIn" size={18} />
        </button>
        <button className="bb-btn" onClick={() => rf.zoomOut()} title="缩小">
          <Icon name="zoomOut" size={18} />
        </button>
        <button className="bb-btn" onClick={() => rf.fitView({ padding: 0.2, maxZoom: 1 })} title="适配视图">
          <Icon name="maximize" size={16} />
        </button>
        <span className="bb-sep" />
        <button className="bb-btn" onClick={toggleFullscreen} title="全屏">
          <Icon name="fullscreen" size={16} />
        </button>
        <button className={'bb-btn' + (canvasLocked ? ' on' : '')} onClick={toggleCanvasLock} title={canvasLocked ? '解锁画布' : '锁定画布'}>
          <Icon name={canvasLocked ? 'unlock' : 'lock'} size={16} />
        </button>
      </div>
    </div>
  );
}
