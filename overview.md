# 远程图库 + 视频合成后端（"都做" 落地）

## 完成内容

### 1. 远程图库 `/api/remote-list`（GET）
- 后端遍历 ComfyUI 历史产出（`/history?max_items=N`），从 `images/gifs/videos/audios` 四类桶收文件，**按文件后缀判定媒体类型**（关键的坑：mp4 常被 ComfyUI 放进 `images` 桶，不能按桶名判）。
- 回填资产 `{media,filename,subfolder,type,source:'remote',gallery:true,url}`，按 `filename|subfolder|type` 去重。
- 前端 `store.fetchRemoteList()`：App 挂载时拉一次；切到「远程」tab 或点刷新按钮时再拉；合并进全局 `assets`，仍走 `source==='remote'` 过滤进「远程」标签页。`icons.jsx` 新增 `refreshCw`。

### 2. 视频合成后端 `/api/compose`（POST）
- `compose` 工具从脚手架改为正式接入，**完全走服务端 ffmpeg 拼接**，不经过 ComfyUI 渲染。
- 流程：校验片段≥1 → `fetchAssetBytes` 拉每个片段字节到临时目录 → 写 concat `list.txt` → `ffmpeg -f concat -c copy`；失败逐级回退：①`libx264+yuv420p+aac` 重编码 ②去音频 `-an`（应对无音轨片段）。
- 产物落地 `server/composed/`（已加 `.gitignore`），通过 `app.use('/composed', express.static)` 直链播放。
- 前端 `store.resolveComposeClips(nodeId)` 按 clip1~4 顺序解析上游视频；`runNode` 在 scaffold 判断前特判 `compose`，结果作为 `source:'remote'` 资产（URL 用 `/composed/...`）。

## 校验
- `node --check` 全部通过；`npm run dev:all` 重启后 5173/8787 均 200。
- `/api/remote-list` 返回真实历史 mp4（正确判 video）。
- `/api/compose` 单片段→3.6MB 有效 h264+aac mp4；双片段→6.0MB（23.8s，拼接正确）；`/composed/<name>` 200 直链可播。
- 前端四模块经 Vite 转译均 200 无错。

## 改动文件
- `server/index.js`（新增两个端点 + composed 静态服务 + mediaByExt/runFFmpeg 工具）
- `server/tools.js`（compose 去 scaffold）
- `src/store.js`（fetchRemoteList / resolveComposeClips / compose 分支）
- `src/collections/AssetPanel.jsx`、`src/App.jsx`、`src/components/icons.jsx`、`src/styles/panels.css`
