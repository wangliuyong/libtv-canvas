import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端开发服务器把 /api 与 /view 代理到本地 Express 后端（默认 8787）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // 同时监听 IPv4 / IPv6 / 127.0.0.1，避免浏览器解析 localhost 到 IPv4 时拒绝连接
    proxy: {
      '/api': 'http://localhost:8787',
      '/view': 'http://localhost:8787',
    },
  },
});
