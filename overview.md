# 内置 MiniMax H3 视频工作流画布

完成「文生视频 + 图生视频（首尾帧 + 参考图）」的内置工作流支持，并顺带修复了一个连接路由的固有缺陷。

## 改动概览

### 1. 后端 `server/tools.js` — 首尾帧 + 参考图
- `buildMiniMaxH3Accel` 新增 `last_frame` 输入，并加 `pickName()` 统一兼容三种文件名形态：裸字符串（资产节点）、`{reupload}`（上游工具产出）、`{filename}`（属性面板选库）。
- `i2v` 工具定义改为 `first_frame`（必填）+ `last_frame` + `ref_images`（multi）+ `prompt`。
- `translate('i2v')` 按实际输入**动态选择 task_type**：
  - 仅首帧 → `I2VA`
  - 首帧 + 尾帧 → `FL2VA`
  - 再叠加参考图 → `Hybrid`
  - 仅参考图 → `Ref2VA`
- 已用 node 脚本验证四种组合的 link 都指向正确的 `LoadImage` 节点。

### 2. 连接把手路由（重大修复）`nodes.jsx` + `store.js`
- 工具节点的目标把手 id 由 `inp.type` 改为 `IN:`+`inp.key`。**原因**：旧方案下同一工具多个同名类型输入（如 i2v 三个 image 输入、`color` 两个 image 输入）无法区分，且 React Flow 要求同节点把手 id 唯一。
- `onConnect`：按输入类型校验（仅允许上游媒体类型 === 目标输入类型），非 multi 输入同把手只保留一条连线。
- `resolveInputs` / `resolveComposeClips`：改用 `IN:`+key 匹配，并保留旧画布兼容回退（当某工具该类型输入唯一时仍按媒体类型匹配）。

### 3. `Inspector.jsx` — 多参考图
- `multi:true` 的媒体输入支持上传/选库添加多张参考图（`refs[key]` 存数组），缩略图网格 + 单张移除 / 清空。新增 `pushRef` / `removeRefAt`。

### 4. 内置模板画布 `store.js` + `Home.jsx`
- `store.js` 导出 `TEMPLATES`（`blank` + `minimax_video`），`createCanvas(name, templateId)` 支持预铺节点与连线。
- 主页「新建画布」表单新增模板下拉。MiniMax 模板：文本提示词 + 首帧/尾帧/参考图×2 资产节点，已连好 `t2v` 与 `i2v`（首尾帧 + 参考）。

## 验证
- `npm run build` 通过（1999 模块）。
- 后端 translate 逻辑用 node 脚本验证 4 种 task_type 组合均正确。
- 已重启 `dev:all`（前端 5173 / 后端 8787 均 200；后台任务 Kh1D7e）。前端改动经 Vite HMR 已生效，后端改动需重启已执行。

## 提交
- 已 commit：`7ca8e3b`（未 push）。如需推送到远程请告知。

## 使用方式
1. 主页 → 新建画布 → 模板选「MiniMax H3 视频生成」。
2. 给首帧图/尾帧图/参考图节点上传图片（或直接把资产库图片拖到对应输入把手）。
3. 在文本节点填写提示词，运行 `t2v` / `i2v` 节点即可。
