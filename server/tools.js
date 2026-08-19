// LibTV 工具 → ComfyUI API 工作流 的映射层。
// 每个 translate(toolId, params, inputs) 返回：
//   { prompt, saveNodes:[{id, media}], scaffold?:true, message? }
// prompt 是 ComfyUI API 格式（节点 id 为字符串，依赖用 ["节点id","槽位"]）。

// MiniMax-H3 专用模型文件名（来自实例实际加载器下拉项）
export const MINIMAX = {
  clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae: 'minimax_h3_video_vae_fp16.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
};

// 加速链路专用：int8 量化 UNet + turbo LoRA（抓取到的实际运行配置）
export const REF2VA_UNET = 'minimax_h3_ref2va_int8_convrot.safetensors';
export const TURBO_LORA = 'minimax_h3_turbo_v4_step600_ema_comfyui.safetensors';

// 把「上游资产 / 属性面板参考」里的文件名统一解析为 ComfyUI input 目录下的裸文件名。
// 兼容三种取值：裸字符串（来自资产节点）、{ reupload:{filename,...} }（来自上游工具产出）、
// { filename }（Inspector 直接选库）。统一返回字符串或 null。
function pickName(x) {
  if (!x) return null;
  if (typeof x === 'string') return x;
  if (x.reupload) return x.reupload.filename || x.reupload;
  if (x.filename) return x.filename;
  return null;
}

// ---- MiniMax-H3 加速管线（turbo LoRA + 双时钟采样，steps 默认 8）----
// 支持：首帧(first_frame)、尾帧(last_frame)、多张参考图(ref_images)、驱动/参考音频。
// task_type 由上层按输入动态选择：T2VA / I2VA / FL2VA(首尾帧) / Ref2VA(参考图) / Hybrid(首尾帧+参考图)。
function buildMiniMaxH3Accel(p) {
  const n = {};
  n['1'] = { class_type: 'UNETLoader', inputs: { unet_name: REF2VA_UNET, weight_dtype: 'default' } };
  let modelOut = ['1', 0];
  if (p.turbo !== false) {
    n['2'] = { class_type: 'LoraLoaderBypassModelOnly', inputs: { model: ['1', 0], lora_name: TURBO_LORA, strength_model: 1.0 } };
    modelOut = ['2', 0];
  }
  n['3'] = { class_type: 'CLIPLoader', inputs: { clip_name: MINIMAX.clip, type: 'minimax' } };
  n['4'] = { class_type: 'VAELoader', inputs: { vae_name: MINIMAX.videoVae } };
  n['5'] = { class_type: 'VAELoader', inputs: { vae_name: MINIMAX.audioVae } };

  const refDict = {};
  let rid = 20;
  (p.refImages || []).map(pickName).filter(Boolean).forEach((f, i) => { n[String(rid)] = { class_type: 'LoadImage', inputs: { image: f } }; refDict['ref_image_' + i] = [String(rid), 0]; rid++; });
  let firstFrame;
  const ff = pickName(p.firstFrame);
  if (ff) { n[String(rid)] = { class_type: 'LoadImage', inputs: { image: ff } }; firstFrame = [String(rid), 0]; rid++; }
  let lastFrame;
  const lf = pickName(p.lastFrame);
  if (lf) { n[String(rid)] = { class_type: 'LoadImage', inputs: { image: lf } }; lastFrame = [String(rid), 0]; rid++; }
  let driveAudio;
  const da = pickName(p.driveAudio);
  if (da) { n[String(rid)] = { class_type: 'LoadAudio', inputs: { audio: da } }; driveAudio = [String(rid), 0]; rid++; }
  const refAudioDict = {};
  (p.refAudios || []).map(pickName).filter(Boolean).forEach((f, i) => { n[String(rid)] = { class_type: 'LoadAudio', inputs: { audio: f } }; refAudioDict['ref_audio_' + i] = [String(rid), 0]; rid++; });

  const c10 = {
    class_type: 'MiniMaxH3AudioConditioningT8',
    inputs: {
      clip: ['3', 0], video_vae: ['4', 0], audio_vae: ['5', 0],
      prompt: p.prompt, width: p.width | 0, height: p.height | 0, length: p.length | 0,
      task_type: p.taskType || 'Ref2VA',
      audio_mode: p.audioMode || 'native',
      audio_denoise_strength: p.audioMode === 'remix_source' ? 0.6 : 1.0,
      add_source_as_reference: false, prompt_primary_audio_ordinal: 0, strict_prompt_tags: true,
      ref_image_size: 'match', reference_video_policy: 'official_2_to_15s',
      ref_images: refDict, drive_audio: driveAudio, ref_audios: refAudioDict,
    },
  };
  // 首帧/尾帧为可选 link 输入：有则连，无则省略（避免给 T2VA/I2VA 注入空连接）
  if (firstFrame) c10.inputs.first_frame = firstFrame;
  if (lastFrame) c10.inputs.last_frame = lastFrame;
  n['10'] = c10;
  n['8'] = {
    class_type: 'MiniMaxH3DualClockSamplerT8',
    inputs: { model: modelOut, av_latent: ['10', 1], steps: p.steps | 0 || 8, shift_video: 12.0, shift_audio: 3.0, sampler_name: 'dual_clock_euler', scheduler: 'native_flow' },
  };
  n['9'] = { class_type: 'RandomNoise', inputs: { noise_seed: p.seed | 0 } };
  n['11'] = { class_type: 'BasicGuider', inputs: { model: ['8', 0], conditioning: ['10', 0] } };
  n['12'] = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['9', 0], guider: ['11', 0], sampler: ['8', 1], sigmas: ['8', 2], latent_image: ['10', 1] } };
  n['13'] = { class_type: 'MiniMaxH3AVDecodeT8', inputs: { av_latent: ['12', 0], video_vae: ['4', 0], audio_vae: ['5', 0] } };
  n['14'] = { class_type: 'CreateVideo', inputs: { images: ['13', 0], audio: ['13', 1], fps: 24.0, bit_depth: 8 } };
  n['15'] = { class_type: 'SaveVideo', inputs: { video: ['14', 0], filename_prefix: p.prefix || 'h3', format: 'mp4', codec: 'auto' } };
  return { prompt: n, saveNodes: [{ id: '15', media: 'video' }] };
}

// ---- 工具注册表（前端 UI / 后端共用同一份语义）----
// inputs: 连线输入把手（type 决定只能接哪种资产节点）
// params: 属性面板里可编辑的参数
export const TOOLS = [
  {
    id: 't2i', name: '文生图', cat: 'image', icon: '🖼️',
    desc: '文本提示词生成一张图（SDXL / Flux 等 checkpoint）',
    inputs: [
      { key: 'prompt', label: '提示词', type: 'text', required: true },
      { key: 'negative', label: '负向词', type: 'text' },
    ],
    outputs: ['image'],
    params: [
      { key: 'ckpt', label: '模型', type: 'select', model: 'checkpoints', default: 'epicrealism_xl.safetensors' },
      { key: 'width', label: '宽', type: 'number', default: 1024 },
      { key: 'height', label: '高', type: 'number', default: 1024 },
      { key: 'steps', label: '步数', type: 'number', default: 30 },
      { key: 'cfg', label: 'CFG', type: 'number', default: 7 },
      { key: 'seed', label: '种子', type: 'number', default: 0 },
      { key: 'prefix', label: '文件名前缀', type: 'text', default: 't2i' },
    ],
  },
  {
    id: 'char3view', name: '角色三视图', cat: 'image', icon: '🧍',
    desc: '基于提示词一次性生成正面/侧面/背面三视图（3×文生图）',
    inputs: [{ key: 'prompt', label: '角色描述', type: 'text', required: true }],
    outputs: ['image'],
    params: [
      { key: 'ckpt', label: '模型', type: 'select', model: 'checkpoints', default: 'epicrealism_xl.safetensors' },
      { key: 'prefix', label: '文件名前缀', type: 'text', default: 'char3v' },
    ],
  },
  {
    id: 'storyboard', name: '多机位分镜', cat: 'image', icon: '🎞️',
    desc: '把一个场景拆成 N 个镜头批量出图（N×文生图）',
    inputs: [{ key: 'prompt', label: '场景/剧本', type: 'text', required: true }],
    outputs: ['image'],
    params: [
      { key: 'ckpt', label: '模型', type: 'select', model: 'checkpoints', default: 'epicrealism_xl.safetensors' },
      { key: 'shots', label: '镜头数', type: 'number', default: 4 },
      { key: 'prefix', label: '文件名前缀', type: 'text', default: 'story' },
    ],
  },
  {
    id: 'i2v', name: '图生视频 / 首帧', cat: 'video', icon: '🎬',
    desc: '以一张图作为首帧，MiniMax-H3 生成带画面视频（I2VA）',
    inputs: [
      { key: 'image', label: '首帧图', type: 'image', required: true },
      { key: 'prompt', label: '运动/镜头提示', type: 'text', required: true },
    ],
    outputs: ['video'],
    params: [
      { key: 'width', label: '宽', type: 'number', default: 1344 },
      { key: 'height', label: '高', type: 'number', default: 768 },
      { key: 'duration', label: '时长(秒)', type: 'select', options: ['5', '6', '8', '10', '12', '15'], default: '8' },
      { key: 'steps', label: '步数(加速=4)', type: 'number', default: 4 },
      { key: 'turbo', label: '加速(turbo LoRA)', type: 'select', options: ['true', 'false'], default: 'true' },
      { key: 'seed', label: '种子', type: 'number', default: 0 },
      { key: 'prefix', label: '文件名前缀', type: 'text', default: 'i2v' },
    ],
  },
  {
    id: 'i2vfl', name: '首尾帧生视频', cat: 'video', icon: '🎬',
    desc: 'MiniMax-H3：首帧必填 + 尾帧可选，生成两帧之间的连贯视频（FL2VA）',
    inputs: [
      { key: 'first_frame', label: '首帧图', type: 'image', required: true },
      { key: 'last_frame', label: '尾帧图', type: 'image' },
      { key: 'prompt', label: '提示词', type: 'text', required: true },
    ],
    outputs: ['video'],
    params: [
      { key: 'width', label: '宽', type: 'number', default: 1344 },
      { key: 'height', label: '高', type: 'number', default: 768 },
      { key: 'duration', label: '时长(秒)', type: 'select', options: ['5', '6', '8', '10', '12', '15'], default: '8' },
      { key: 'steps', label: '步数(加速=4)', type: 'number', default: 4 },
      { key: 'turbo', label: '加速(turbo LoRA)', type: 'select', options: ['true', 'false'], default: 'true' },
      { key: 'seed', label: '种子', type: 'number', default: 0 },
      { key: 'prefix', label: '文件名前缀', type: 'text', default: 'i2vfl' },
    ],
  },
  {
    id: 'ref2v', name: '多参考图生视频', cat: 'video', icon: '🖼️➡️🎬',
    desc: '多张参考图 + 提示词（可用 @ 引用资产库图片/声音），MiniMax-H3 生成一致性视频（Ref2VA）',
    inputs: [
      { key: 'ref_images', label: '参考图', type: 'image', multi: true, required: true },
      { key: 'audio', label: '参考音频(可选)', type: 'audio' },
      { key: 'prompt', label: '提示词（@图片/@声音）', type: 'text', required: true },
    ],
    outputs: ['video'],
    params: [
      { key: 'width', label: '宽', type: 'number', default: 1344 },
      { key: 'height', label: '高', type: 'number', default: 768 },
      { key: 'duration', label: '时长(秒)', type: 'select', options: ['5', '6', '8', '10', '12', '15'], default: '8' },
      { key: 'steps', label: '步数(加速=4)', type: 'number', default: 4 },
      { key: 'turbo', label: '加速(turbo LoRA)', type: 'select', options: ['true', 'false'], default: 'true' },
      { key: 'seed', label: '种子', type: 'number', default: 0 },
      { key: 'prefix', label: '文件名前缀', type: 'text', default: 'ref2v' },
    ],
  },
  {
    id: 't2v', name: '文生视频', cat: 'video', icon: '💬➡️🎬',
    desc: '纯文本生成视频（MiniMax T2V-01）',
    inputs: [{ key: 'prompt', label: '视频提示词', type: 'text', required: true }],
    outputs: ['video'],
    params: [
      { key: 'width', label: '宽', type: 'number', default: 1344 },
      { key: 'height', label: '高', type: 'number', default: 768 },
      { key: 'duration', label: '时长(秒)', type: 'select', options: ['5', '6', '8', '10', '12', '15'], default: '8' },
      { key: 'steps', label: '步数(加速=4)', type: 'number', default: 4 },
      { key: 'turbo', label: '加速(turbo LoRA)', type: 'select', options: ['true', 'false'], default: 'true' },
      { key: 'seed', label: '种子', type: 'number', default: 0 },
      { key: 'prefix', label: '文件名前缀', type: 'text', default: 't2v' },
    ],
  },
  {
    id: 'a2v', name: '音频生视频', cat: 'video', icon: '🔊➡️🎬',
    desc: '以音频 + 参考图驱动，MiniMax-H3 生成音画同步视频',
    inputs: [
      { key: 'audio', label: '驱动音频', type: 'audio', required: true },
      { key: 'ref_images', label: '参考图(可选)', type: 'image', multi: true },
      { key: 'prompt', label: '提示词', type: 'text', required: true },
    ],
    outputs: ['video'],
    params: [
      { key: 'width', label: '宽', type: 'number', default: 1344 },
      { key: 'height', label: '高', type: 'number', default: 768 },
      { key: 'duration', label: '时长(秒)', type: 'select', options: ['5', '6', '8', '10', '12', '15'], default: '8' },
      { key: 'steps', label: '步数(加速=4)', type: 'number', default: 4 },
      { key: 'turbo', label: '加速(turbo LoRA)', type: 'select', options: ['true', 'false'], default: 'true' },
      { key: 'prefix', label: '文件名前缀', type: 'text', default: 'a2v' },
    ],
  },
  {
    id: 'upscale', name: '图片放大', cat: 'image', icon: '🔍',
    desc: 'RealESRGAN 4x 超分辨率放大',
    inputs: [{ key: 'image', label: '待放大图', type: 'image', required: true }],
    outputs: ['image'],
    params: [
      { key: 'model', label: '放大模型', type: 'select', model: 'upscale', default: 'RealESRGAN_x4plus.safetensors' },
      { key: 'prefix', label: '文件名前缀', type: 'text', default: 'up' },
    ],
  },
  {
    id: 'ref2i', name: '参考图生图', cat: 'image', icon: '🖼️➡️🖼️',
    desc: '以一张参考图为基础，按提示词重绘生成新图（img2img，SDXL）',
    inputs: [
      { key: 'image', label: '参考图', type: 'image', required: true },
      { key: 'prompt', label: '提示词', type: 'text', required: true },
      { key: 'negative', label: '负向词', type: 'text' },
    ],
    outputs: ['image'],
    params: [
      { key: 'ckpt', label: '模型', type: 'select', model: 'checkpoints', default: 'epicrealism_xl.safetensors' },
      { key: 'denoise', label: '重绘强度', type: 'number', default: 0.6 },
      { key: 'steps', label: '步数', type: 'number', default: 30 },
      { key: 'cfg', label: 'CFG', type: 'number', default: 7 },
      { key: 'seed', label: '种子', type: 'number', default: 0 },
      { key: 'prefix', label: '文件名前缀', type: 'text', default: 'ref2i' },
    ],
  },
  {
    id: 'color', name: '调色', cat: 'image', icon: '🎨',
    desc: '色彩迁移：把目标图色调匹配到参考视频/图',
    inputs: [
      { key: 'image', label: '待调色', type: 'image', required: true },
      { key: 'reference', label: '参考色调', type: 'image', required: true },
    ],
    outputs: ['image'],
    params: [
      { key: 'method', label: '方法', type: 'select', options: ['hm-mvgd-hm', 'hm-mkl-hm', 'mkl', 'mvgd', 'hm', 'reinhard'], default: 'hm-mvgd-hm' },
      { key: 'strength', label: '强度', type: 'number', default: 0.8 },
      { key: 'prefix', label: '文件名前缀', type: 'text', default: 'color' },
    ],
  },
  {
    id: 'interp', name: '视频补帧', cat: 'video', icon: '⏩', scaffold: true,
    desc: 'RIFE 帧插值（需视频 IO 节点，当前为脚手架）',
    inputs: [{ key: 'video', label: '原视频', type: 'video', required: true }],
    outputs: ['video'],
    params: [{ key: 'multiplier', label: '倍数', type: 'number', default: 2 }],
  },
  {
    id: 'bg', name: '图片换背景', cat: 'image', icon: '🌅', scaffold: true,
    desc: 'Inpaint/Outpaint 换背景（需遮罩流程，当前为脚手架）',
    inputs: [
      { key: 'image', label: '主体图', type: 'image', required: true },
      { key: 'prompt', label: '新背景描述', type: 'text', required: true },
    ],
    outputs: ['image'],
    params: [],
  },
  {
    id: 'compose', name: '视频合成', cat: 'video', icon: '🎞️',
    desc: '把多条视频片段按序拼接成成片（服务端 ffmpeg concat 拼接，无需远程渲染）',
    inputs: [
      { key: 'clip1', label: '片段1', type: 'video', required: true },
      { key: 'clip2', label: '片段2', type: 'video' },
      { key: 'clip3', label: '片段3', type: 'video' },
      { key: 'clip4', label: '片段4', type: 'video' },
    ],
    outputs: ['video'],
    params: [{ key: 'fps', label: '帧率', type: 'number', default: 24 }],
  },
  {
    id: 'voiceswap', name: '视频换音色', cat: 'video', icon: '🎙️',
    desc: '把视频里的人声换成另一个音色（CosyVoice3 声音转换），可选 Kling 对口型输出新视频',
    inputs: [
      { key: 'video', label: '原视频', type: 'video', required: true },
      { key: 'ref_audio', label: '目标音色参考', type: 'audio', required: true },
    ],
    outputs: ['video'],
    params: [
      { key: 'speed', label: '语速', type: 'number', default: 1.0 },
      { key: 'voice_language', label: '口型语言', type: 'select', options: ['zh', 'en'], default: 'zh' },
      { key: 'lipsync', label: '对口型出视频', type: 'select', options: ['true', 'false'], default: 'true' },
      { key: 'model_version', label: 'CosyVoice 模型', type: 'select', options: ['Fun-CosyVoice3-0.5B', 'CosyVoice2-0.5B', 'CosyVoice-300M'], default: 'Fun-CosyVoice3-0.5B' },
      { key: 'prefix', label: '文件名前缀', type: 'text', default: 'voiceswap' },
    ],
  },
];

export function getTool(id) {
  return TOOLS.find((t) => t.id === id);
}

// ---- 内部：构建单条文生图链，返回 { nodes, saveId } ----
function t2iChain(idStart, p, prompt, neg, prefix) {
  const n = {};
  let i = idStart;
  const ck = String(i++);
  n[ck] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.ckpt } };
  const pos = String(i++);
  n[pos] = { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: [ck, 1] } };
  const negN = String(i++);
  n[negN] = { class_type: 'CLIPTextEncode', inputs: { text: neg, clip: [ck, 1] } };
  const lat = String(i++);
  n[lat] = { class_type: 'EmptyLatentImage', inputs: { width: p.width | 0, height: p.height | 0, batch_size: 1 } };
  const k = String(i++);
  n[k] = {
    class_type: 'KSampler',
    inputs: {
      model: [ck, 0], positive: [pos, 0], negative: [negN, 0], latent_image: [lat, 0],
      seed: p.seed | 0, steps: p.steps | 0, cfg: p.cfg, sampler_name: 'euler', scheduler: 'normal', denoise: 1.0,
    },
  };
  const dec = String(i++);
  n[dec] = { class_type: 'VAEDecode', inputs: { samples: [k, 0], vae: [ck, 2] } };
  const sv = String(i++);
  n[sv] = { class_type: 'SaveImage', inputs: { images: [dec, 0], filename_prefix: prefix } };
  return { nodes: n, saveId: sv };
}

// ---- 内部：构建 img2img 链（参考图 → VAEEncode → KSampler(denoise<1) → 出图）----
function i2iChain(idStart, p, prompt, neg, prefix) {
  const n = {};
  let i = idStart;
  const ck = String(i++);
  n[ck] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.ckpt } };
  const pos = String(i++);
  n[pos] = { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: [ck, 1] } };
  const negN = String(i++);
  n[negN] = { class_type: 'CLIPTextEncode', inputs: { text: neg, clip: [ck, 1] } };
  const load = String(i++);
  n[load] = { class_type: 'LoadImage', inputs: { image: p.image } };
  const enc = String(i++);
  n[enc] = { class_type: 'VAEEncode', inputs: { pixels: [load, 0], vae: [ck, 2] } };
  const k = String(i++);
  n[k] = {
    class_type: 'KSampler',
    inputs: {
      model: [ck, 0], positive: [pos, 0], negative: [negN, 0], latent_image: [enc, 0],
      seed: p.seed | 0, steps: p.steps | 0, cfg: p.cfg, sampler_name: 'euler', scheduler: 'normal',
      denoise: P_denoise(p.denoise),
    },
  };
  const dec = String(i++);
  n[dec] = { class_type: 'VAEDecode', inputs: { samples: [k, 0], vae: [ck, 2] } };
  const sv = String(i++);
  n[sv] = { class_type: 'SaveImage', inputs: { images: [dec, 0], filename_prefix: prefix } };
  return { nodes: n, saveId: sv };
}

// 重绘强度兜底（0~1，默认 0.6）
function P_denoise(v) {
  const x = Number(v);
  if (!isFinite(x)) return 0.6;
  return Math.min(1, Math.max(0, x));
}

// —— MiniMax H3 开源版分辨率限制（官方规格）——
// 分辨率网格按 32 对齐；短边默认 768px（上限 768×1344，最低 384p，256p 会直接生成失败）。
// 任意宽高输入都会被规整到合法网格，避免非法尺寸导致生成失败。
const H3_MIN_EDGE = 384;
const H3_MAX_SHORT = 768;
const H3_MAX_LONG = 1344;
function h3Fit(w, h) {
  const W = Math.max(1, Number(w) || 1344);
  const H = Math.max(1, Number(h) || 768);
  const short = Math.min(W, H);
  const scale = Math.max(H3_MIN_EDGE, Math.min(H3_MAX_SHORT, short)) / short;
  const align = (v) => Math.max(H3_MIN_EDGE, Math.min(H3_MAX_LONG, Math.round((v * scale) / 32) * 32));
  return { width: align(W), height: align(H) };
}

// —— MiniMax H3 帧数硬规则（ComfyUI 节点源码 + 实测）——
// 帧数必须落在 17k+5 网格（源码 while n%17!=5: n++，向上吸附）；训练区间 124~362 帧（24fps ≈ 5.17~15.08s）。
// 时长(秒) → 帧数：秒×24 后向上吸附到 17k+5；帧数 → 帧数：直接吸附。
function h3FramesFromSec(sec) {
  const s = Math.max(4, Math.min(15, Math.round(Number(sec) || 8)));
  const want = s * 24;
  const n = Math.ceil((want - 5) / 17) * 17 + 5;
  return Math.max(124, Math.min(362, n));
}
function h3FramesFromLen(frames) {
  let n = Math.max(0, Math.round(Number(frames) || 0));
  while (n % 17 !== 5) n++;
  return Math.max(124, Math.min(362, n));
}
// 节点可配置「时长(秒)」或旧画布的「帧数」；优先 duration，回退 length
function h3Len(P) {
  if (P.duration !== undefined && P.duration !== null && P.duration !== '') return h3FramesFromSec(P.duration);
  return h3FramesFromLen(P.length);
}

// ---- 翻译入口 ----
export function translate(toolId, params = {}, inputs = {}) {
  const P = { ...params };
  const prompt = inputs.prompt || P.prompt || '';
  const neg = inputs.negative || P.negative || '';

  switch (toolId) {
    case 't2v':
      return buildMiniMaxH3Accel({
        ...h3Fit(P.width, P.height), prompt, length: h3Len(P),
        taskType: 'T2VA', audioMode: 'native', steps: P.steps, turbo: P.turbo !== 'false',
        refAudios: inputs.ref_audios || [], seed: P.seed | 0, prefix: P.prefix || 't2v',
      });
    case 'i2v':
      return buildMiniMaxH3Accel({
        ...h3Fit(P.width, P.height), prompt, length: h3Len(P),
        taskType: 'I2VA', audioMode: 'native', steps: P.steps, turbo: P.turbo !== 'false',
        firstFrame: inputs.image, refAudios: inputs.ref_audios || [], seed: P.seed | 0, prefix: P.prefix || 'i2v',
      });
    case 'i2vfl': {
      const firstFrame = inputs.first_frame;
      const lastFrame = inputs.last_frame;
      return buildMiniMaxH3Accel({
        ...h3Fit(P.width, P.height), prompt, length: h3Len(P),
        taskType: firstFrame && lastFrame ? 'FL2VA' : 'I2VA', audioMode: 'native', steps: P.steps, turbo: P.turbo !== 'false',
        firstFrame, lastFrame, refAudios: inputs.ref_audios || [], seed: P.seed | 0, prefix: P.prefix || 'i2vfl',
      });
    }
    case 'ref2v':
      return buildMiniMaxH3Accel({
        ...h3Fit(P.width, P.height), prompt, length: h3Len(P),
        taskType: 'Ref2VA', audioMode: 'native', steps: P.steps, turbo: P.turbo !== 'false',
        refImages: inputs.ref_images || [],
        refAudios: [inputs.audio, ...(inputs.ref_audios || [])].filter(Boolean),
        seed: P.seed | 0, prefix: P.prefix || 'ref2v',
      });
    case 'a2v':
      return buildMiniMaxH3Accel({
        ...h3Fit(P.width, P.height), prompt, length: h3Len(P),
        taskType: 'Ref2VA', audioMode: 'remix_source', steps: P.steps, turbo: P.turbo !== 'false',
        driveAudio: inputs.audio, refImages: inputs.ref_images || [], refAudios: inputs.ref_audios || [],
        seed: P.seed | 0, prefix: P.prefix || 'a2v',
      });
    case 'upscale': {
      const n = {};
      n['10'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: P.model || 'RealESRGAN_x4plus.safetensors' } };
      n['11'] = { class_type: 'LoadImage', inputs: { image: inputs.image } };
      n['12'] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['10', 0], image: ['11', 0] } };
      n['13'] = { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: P.prefix || 'up' } };
      return { prompt: n, saveNodes: [{ id: '13', media: 'image' }] };
    }
    case 'color': {
      const n = {};
      n['10'] = { class_type: 'LoadImage', inputs: { image: inputs.image } };
      n['11'] = { class_type: 'LoadImage', inputs: { image: inputs.reference } };
      n['12'] = { class_type: 'VideoColorCorrectV3', inputs: { images: ['10', 0], reference_video: ['11', 0], method: P.method || 'hm-mvgd-hm', strength: P.strength ?? 0.8 } };
      n['13'] = { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: P.prefix || 'color' } };
      return { prompt: n, saveNodes: [{ id: '13', media: 'image' }] };
    }
    case 'char3view': {
      const n = {};
      const views = ['正面全身', '侧面全身', '背面全身'];
      let id = 10;
      const saves = [];
      views.forEach((v, i) => {
        const p = { ...P, width: 768, height: 1024, steps: 28, cfg: 6, seed: (P.seed || 0) + i * 101 };
        const r = t2iChain(id, p, `${prompt}，${v}，三视图，一致角色设计，白色背景`, neg, `${P.prefix || 'char3v'}_${i}`);
        Object.assign(n, r.nodes);
        saves.push({ id: r.saveId, media: 'image' });
        id = Math.max(...Object.keys(n).map(Number)) + 1;
      });
      return { prompt: n, saveNodes: saves };
    }
    case 'storyboard': {
      const n = {};
      const shots = Math.max(1, P.shots | 0 || 4);
      let id = 10;
      const saves = [];
      for (let i = 0; i < shots; i++) {
        const p = { ...P, width: 1280, height: 720, steps: 25, cfg: 6.5, seed: (P.seed || 0) + i * 777 };
        const r = t2iChain(id, p, `${prompt}。镜头${i + 1}，电影感构图`, neg, `${P.prefix || 'story'}_${i}`);
        Object.assign(n, r.nodes);
        saves.push({ id: r.saveId, media: 'image' });
        id = Math.max(...Object.keys(n).map(Number)) + 1;
      }
      return { prompt: n, saveNodes: saves };
    }
    case 'ref2i': {
      const r = i2iChain(10, { ...P, image: inputs.image, denoise: P.denoise, steps: P.steps || 30, cfg: P.cfg || 7, seed: P.seed || 0 }, prompt, neg, P.prefix || 'ref2i');
      return { prompt: r.nodes, saveNodes: [{ id: r.saveId, media: 'image' }] };
    }
    case 'voiceswap': {
      // inputs 由后端 prepareVoiceSwap 预处理后传入（均为 ComfyUI input 目录下的文件名）：
      //   video        原视频（LoadVideo 只读 input 目录）
      //   ref_audio    目标音色参考音频
      //   source_speech 从原视频抽出的干净人声
      const n = {};
      n['1'] = { class_type: 'FL_CosyVoice3_ModelLoader', inputs: { model_version: P.model_version || 'Fun-CosyVoice3-0.5B', download_source: 'HuggingFace', device: 'auto' } };
      n['2'] = { class_type: 'LoadAudio', inputs: { audio: inputs.source_speech } };
      n['3'] = { class_type: 'LoadAudio', inputs: { audio: inputs.ref_audio } };
      n['4'] = {
        class_type: 'FL_CosyVoice3_VoiceConversion',
        inputs: { model: ['1', 0], source_audio: ['2', 0], target_audio: ['3', 0], speed: Number(P.speed) || 1.0 },
      };
      n['5'] = { class_type: 'SaveAudio', inputs: { audio: ['4', 0], filename_prefix: P.prefix || 'voiceswap' } };
      n['6'] = { class_type: 'LoadVideo', inputs: { file: inputs.video } };
      const lipsync = P.lipsync !== 'false';
      let saveNodes;
      if (lipsync) {
        n['7'] = { class_type: 'KlingLipSyncAudioToVideoNode', inputs: { video: ['6', 0], audio: ['4', 0], voice_language: P.voice_language || 'zh' } };
        saveNodes = [{ id: '7', media: 'video' }];
      } else {
        // 无云端对口型 key 时，仅输出换音色后的音频，用户可本地 ffmpeg 贴回视频
        saveNodes = [{ id: '5', media: 'audio' }];
      }
      return { prompt: n, saveNodes };
    }
    case 't2i':
    default: {
      const r = t2iChain(10, { ...P, width: P.width || 1024, height: P.height || 1024, steps: P.steps || 30, cfg: P.cfg || 7, seed: P.seed || 0 }, prompt, neg, P.prefix || 't2i');
      return { prompt: r.nodes, saveNodes: [{ id: r.saveId, media: 'image' }] };
    }
  }
}
