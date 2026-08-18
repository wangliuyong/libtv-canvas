import React, { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import Icon from './icons.jsx';

export default function StatusBar() {
  const jobs = useStore((s) => s.jobs);
  const [queue, setQueue] = useState({ running: 0, pending: 0 });

  useEffect(() => {
    const tick = async () => {
      try { const r = await fetch('/api/queue'); const j = await r.json();
        setQueue({ running: (j.queue_running || []).length, pending: (j.queue_pending || []).length }); } catch (e) {}
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, []);

  const running = jobs.filter((j) => j.status === 'running').length;
  return (
    <div className="statusbar">
      <span><Icon name="globe" size={14} /> ComfyUI 队列：运行 {queue.running} / 排队 {queue.pending}</span>
      <span>本画布任务：{jobs.length}（进行中 {running}）</span>
      <span className="jobs">
        {jobs.slice(-5).map((j) => (
          <span key={j.id} className={'job ' + j.status} title={j.tool}><span className="dot" /> {j.tool}</span>
        ))}
      </span>
    </div>
  );
}
