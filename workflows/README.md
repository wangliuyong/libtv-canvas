# 视频换音色工作流（ComfyUI）

针对远程 ComfyUI（`server/config.local.json` 中的 `comfyUrl`）搭建的「给视频更换说话人音色」工作流。

> 文件：`video-voice-swap.json` —— ComfyUI **API 格式**（`/prompt` 的 `prompt` 字段内容）。
> 可直接用 ComfyUI 菜单 **Load (API Format)** 导入，或作为 `POST /prompt` 的 `{"prompt": <本文件内容>, "client_id": "..."}` 提交。

## 这条工作流做了什么

1. 加载 CosyVoice3 语音模型（本地，首次会自动从 HuggingFace/ModelScope 下载）。
2. 读入**原视频人声** `source_speech.wav`（要被替换的声音）。
3. 读入**目标音色参考** `target_voice.wav`（你希望变成谁的声音，任意 3–10s 干净人声即可）。
4. **声音转换** `FL_CosyVoice3_VoiceConversion`：保留原台词内容，把音色换成参考音色 → 新音频。
5. `SaveAudio` 落盘一份换音色后的音频（便于试听 / 排查）。
6. 读入原始视频 `input_video.mp4`。
7. `KlingLipSyncAudioToVideoNode`：把新音频对回原画面口型 → **输出换音色后的视频**。

节点链路：`1(model) → 4`；`2(source) → 4`；`3(target) → 4`；`4 → 5(save)` 且 `4 → 7(lipsync)`；`6(video) → 7`。

## 三种「换音色」方案（按需求选）

| 方案 | 节点 | 是否需要联网/密钥 | 特点 |
|------|------|------------------|------|
| **A. 本地纯换音色（默认本工作流）** | CosyVoice3_VoiceConversion + KlingLipSync | 模型首次下载需网；Kling 对口型需 Kling API key | 同语言、保留台词、只换声线；最可控 |
| **B. 一键翻译配音** | `HeyGenVideoTranslateNode` | 需 HeyGen API key | 单节点：视频进、翻译+配音+对口型视频出；会换成目标语言 |
| **C. 本地对口型替代** | `SyncLipSyncNode`（sync.so） | 需 sync.so API key | 本地模型调度，但推理走 sync.so 云端 |

如果只想拿到「换了音色的音频」而不做视频，删掉节点 6、7，只跑 1–5 即可（纯本地，无需任何云端 key）。

## 运行前准备（必做）

远程 ComfyUI 的 `LoadAudio` / `LoadVideo` 是从它的 **input 目录**里选文件，所以三个文件要先传到远程机器的 ComfyUI `input/` 下：

- `input_video.mp4` —— 原视频
- `source_speech.wav` —— 原视频的人声（用 ffmpeg 抽，见下）
- `target_voice.wav` —— 目标音色参考（一段干净人声）

从视频抽人声（本机或任意有 ffmpeg 的地方执行，再上传 wav）：

```bash
ffmpeg -i input_video.mp4 -vn -ac 1 -ar 16000 source_speech.wav
```

> 说明：这台远程 ComfyUI 没有「视频抽音轨」类节点（`LoadVideo` 只输出 `VIDEO`，无 `VHS_LoadVideo` / `VHSAudioToAudio`），所以人声抽取放在外部 ffmpeg 完成，这是工作流唯一的非节点步骤。

## 如何加载运行

- **UI 方式**：打开远程 ComfyUI → 菜单 `Load (API Format)` → 选 `video-voice-swap.json` → 检查三个文件下拉是否选中正确文件名 → Queue Prompt。
- **API 方式**：把本文件内容作为 `prompt` 字段，`POST {comfyUrl}/prompt`，轮询 `/history` 取结果。

## 注意事项 / 已知限制

- **KlingLipSync 是云端节点**：需要远程 ComfyUI 已配置 Kling API key，否则节点 7 会报错。没有 key 时，先用节点 1–5 拿到换音色音频，再用本地 ffmpeg 把音频贴回视频（无自动对口型）：
  ```bash
  ffmpeg -i input_video.mp4 -i vc_converted_00001.wav -c:v copy -map 0:v:0 -map 1:a:0 -shortest out.mp4
  ```
- **模型下载**：`FL_CosyVoice3_ModelLoader` 首次运行会从 HuggingFace 拉 `Fun-CosyVoice3-0.5B`（约几百 MB），需联网；可改 `download_source` 为 `ModelScope` 加速。
- **`voice_language`**：KlingLipSync 仅支持 `zh` / `en`，按换后音频语言填。
- **改音色来源**：若想「克隆某个预设音色」而非给参考音频，可把节点 3/4 换成 `FL_CosyVoice3_SpeakerClone` 或 `Qwen3TTSVoiceClone`（见 `object_info`）。
- **换语言+换音色一步到位**：把节点 6、7 整体替换为单个 `HeyGenVideoTranslateNode`（`video` 接 `LoadVideo`，`output_language` 选目标语言如 `Chinese (Mandarin, Simplified)`，`mode` 选 `speed`/`precision`）。
