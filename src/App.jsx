import React, { useEffect, useState } from 'react';
import Canvas from './components/Canvas.jsx';
import Home from './components/Home.jsx';
import Header from './components/Header.jsx';
import NodeModal from './components/NodeModal.jsx';
import AssetDrawer from './components/AssetDrawer.jsx';
import ConfigModal from './components/ConfigModal.jsx';
import Icon from './components/icons.jsx';
import { useStore } from './store.js';

export default function App() {
  const fetchModels = useStore((s) => s.fetchModels);
  const fetchRemoteList = useStore((s) => s.fetchRemoteList);
  const currentCanvasId = useStore((s) => s.currentCanvasId);
  const configOpen = useStore((s) => s.configOpen);
  const setConfigOpen = useStore((s) => s.setConfigOpen);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const saveCurrentCanvas = useStore((s) => s.saveCurrentCanvas);
  const [backendDown, setBackendDown] = useState(false);

  useEffect(() => { fetchModels(); }, [fetchModels]);
  useEffect(() => { fetchRemoteList(); }, [fetchRemoteList]);

  // 探测后端（localhost:8787）连通性：断了显示警告并持续重试，恢复后自动消失
  useEffect(() => {
    let timer;
    const check = async () => {
      try {
        const r = await fetch('/api/models');
        const ok = r.ok;
        setBackendDown(!ok);
        if (!ok) timer = setTimeout(check, 4000);
      } catch {
        setBackendDown(true);
        timer = setTimeout(check, 4000);
      }
    };
    check();
    return () => clearTimeout(timer);
  }, []);

  // 全局撤销/重做：Ctrl/Cmd+Z 撤销，Shift+Ctrl/Cmd+Z 重做；输入框内不拦截，保留原生文本撤销
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target;
      const tag = (t && t.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // 自动保存：当前画布内容变化后防抖落盘（localStorage）
  useEffect(() => {
    if (!currentCanvasId) return;
    const t = setTimeout(() => saveCurrentCanvas(), 800);
    return () => clearTimeout(t);
  }, [nodes, edges, currentCanvasId, saveCurrentCanvas]);

  return (
    <div className="app">
      {backendDown && (
        <div className="backend-warn">
          <Icon name="xCircle" size={14} />
          <span>后端未连接（localhost:8787）——上传 / 生成功能不可用，请先运行 <code>npm run server</code></span>
        </div>
      )}
      <Header />
      {currentCanvasId ? (
        <div className="body">
          <div className="center">
            <Canvas />
          </div>
        </div>
      ) : (
        <Home />
      )}
      <AssetDrawer />
      <NodeModal />
      <ConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
}
