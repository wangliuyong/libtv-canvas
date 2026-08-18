# LibTV 式无限画布 · 接入 ComfyUI

把 **LibTV** 的「无限画布 + 节点式工作流」范式，套用到一台真实 ComfyUI（RTX 4080 SUPER，1436 个节点：MiniMax-H3 / Wan / Kling / HunyuanVideo / LTX / SVD / 放大 / 补帧 / 调色 / Inpaint）。目标地址不写死在代码里，通过环境变量 `COMFY_URL` 或本地配置文件 `server/config.local.json` 指定（见下方「运行」）。

前端是一块可无限缩放平移的画布，上面放 **文本 / 图片 / 视频 / 音频 / 脚本** 五类基础节点，以及若干 **AI 工具节点**（对应 LibTV 的「技能」）。节点间连线即数据流向，运行工具节点会把图翻译成 ComfyUI API 工作流并提交到远程执行，产出回流到画布与资产库。

## 架构

```
浏览器 (React + Vite + ReactFlow 画布)
   │  REST (/api/*)
   ▼
Express 后端 (server/)
   ├─ comfy.js       ComfyUI HTTP 客户端（队列/历史/上传/取流）
   ├─ tools.js       LibTV 工具 → ComfyUI 节点图 翻译层（单一事实源）
   └─ index.js       REST 接口 + /view 代理
   │  HTTP (ComfyUI API)
   ▼
远程 ComfyUI  (MiniMax-H3 / Wan / Kling / …)
```

- **画布状态**：`src/store.js`（zustand）保存 nodes / edges / assets / jobs。
- **工具注册表**：`server/tools.js` 的 `TOOLS` 数组，前端直接 import 复用，前后端单一事实源。
- **工具翻译**：`translate(toolId, params, inputs)` 输出 ComfyUI API 格式 prompt + 产出节点列表。

## 运行

```bash
cd libtv-canvas
npm install
# 终端1：后端（默认 8787，目标 ComfyUI 用 COMFY_URL 覆盖）
npm run server
# 终端2：前端
npm run dev
# 打开 http://localhost:5173
```

环境变量：`COMFY_URL`（目标 ComfyUI 地址，默认 `http://localhost:8188`；也可在 `server/config.local.json` 写入 `comfyUrl` 覆盖，该文件已被 gitignore，不会入库）、`PORT`（默认 8787）。

## 功能 → ComfyUI 映射（已实现）

| LibTV 功能 | 工具 id | 映射节点 |
|---|---|---|
| 文生图 | `t2i` | CheckpointLoaderSimple + CLIPTextEncode + KSampler + VAEDecode |
| 角色三视图 | `char3view` | 3× 文生图链（正/侧/背） |
| 多机位分镜 | `storyboard` | N× 文生图链 |
| 图生视频 / 首帧 | `i2v` | CLIPLoader(minimax)+VAELoader+LoadImage+MiniMaxH3ImageToVideo |
| 参考图生视频 | `ref2v` | MiniMaxH3ReferenceToVideo（多参考图，可选音频） |
| 文生视频 | `t2v` | MinimaxTextToVideoNode (T2V-01) |
| 音频生视频 | `a2v` | MiniMaxH3ReferenceToVideo + ref_audios |
| 图片放大 | `upscale` | UpscaleModelLoader + ImageUpscaleWithModel (RealESRGAN×4) |
| 调色 | `color` | VideoColorCorrectV3（色彩迁移） |

## 脚手架（已列出，待接入节点图）

| LibTV 功能 | 工具 id | 待补 |
|---|---|---|
| 视频补帧 | `interp` | 需视频 IO 节点（LoadVideo / VideoCombine）串 RIFE |
| 图片换背景 | `bg` | 需 Inpaint/Outpaint + 遮罩流程 |

## 界面设计（Aurora Studio 设计系统）

界面已重构为模块化、令牌驱动的 **Aurora Studio 暗色创意工作台**（`src/styles/*.css` + `DESIGN.md`），由 UI Designer 交付：
- **架构**：原单一 `styles.css` 拆分为 `tokens/base/layout/components/panels/canvas` 六模块，`main.jsx` 按序导入，便于维护与扩展。
- **视觉**：暗色工作台（媒体更突出、专业感更强），令牌化双主题（含浅色覆盖，根节点加 `data-theme="light"` 即可切换）。
- 仅样式层改动，**不影响任何交互逻辑、节点连线与后端中转**。

### 交互模型（UI 重构）
- **双击节点卡片** → 弹出「属性维护」模态（复用 Inspector，可改参数 / 运行 / 删除；点遮罩或 Esc 关闭）。
- **资产库** → 移到顶栏右侧图标按钮（🗂️ 资产，带数量角标），点击从右侧滑出抽屉展示资产列表（沿用 AssetPanel）。
- **原右侧「属性 / 资产库」标签页抽屉已移除**；节点选中仅高亮，编辑走双击模态。
- **左侧节点列表**改为可收起抽屉：顶栏「◀ / ☰」按钮折叠/展开（`.node-drawer` 过渡）。
- 画布双击空白仍加文本节点；为支持双击编辑，`zoomOnDoubleClick` 已关闭。

## 界面设计（旧版 Studio Light，已重构）

界面采用统一的 **Studio Light** 设计系统（`src/styles.css` + `DESIGN.md`），由 UI Designer 交付：
- 靛蓝主色 + 紫色工具节点 + 青色输入把手的语义化配色，颜色即"可连类型"提示；
- 柔和纵深阴影、渐变主按钮、友好圆角、悬浮微交互；
- React Flow 画布（点阵背景 / 浮层控件 / 连线动画）视觉统一；
- 仅样式层改动，**不影响任何交互逻辑、节点连线与后端中转**。

## 已实现的核心范式

- ✅ 无限画布（缩放/平移/小地图）、双击空白快速加文本节点
- ✅ 五类基础节点（文本/图片/视频/音频/脚本），图片/视频/音频可上传
- ✅ 节点连线（类型校验：输出类型须等于输入类型）
- ✅ 工具节点运行 → 远程生成 → 产出回流（含 **工具→工具** 链路：上游 output 文件经 `/api/reupload` 回到 input）
- ✅ 属性面板编辑参数、资产库、任务状态栏、项目 JSON 导入导出

## 如何新增一个 LibTV 工具

1. 在 `server/tools.js` 的 `TOOLS` 里加一项（`id/name/cat/inputs/outputs/params`）。
2. 在 `translate()` 的 `switch` 里加一个 `case`，返回 `{ prompt, saveNodes }`（节点 id 用字符串，依赖用 `["节点id","槽位"]`）。
3. 前端自动出现该工具按钮，属性面板自动渲染 `params`，无需改 UI。

## 已知限制

- 远程 ComfyUI 当前满载（抓取时 1 运行 + 18 排队），新任务会排到队尾。
- 工具→工具的图片/视频链路依赖「output→input 回流」，对超大视频有额外上传开销。
- `interp` / `bg` 为脚手架，未接入真实节点图。
- 脚本节点目前是纯文本编辑器；「自动生成分镜/剧本」需要外接 LLM，可后续接入。
- 协作 / 版本管理 / 社区分享等 LibTV 平台级能力未实现（属多用户服务端范畴）。
