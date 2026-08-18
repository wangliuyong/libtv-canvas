import {
  FileText, ScrollText, Image as ImageIcon, Film, Video, AudioLines,
  Users, Clapperboard, Images, Search, Palette, FastForward, Sun,
  Globe, Save, Download, Upload, FolderOpen, PanelLeftClose, PanelLeftOpen, Play,
  Loader2, CheckCircle2, XCircle, X,
} from 'lucide-react';

// 语义名 → Lucide 组件（覆盖基础资产 kind、AI 工具 id、通用 UI 动作）
const MAP = {
  // 基础资产节点
  text: FileText, script: ScrollText, image: ImageIcon, video: Film, audio: AudioLines,
  // AI 工具（与 server/tools.js 的 tool.icon 一致）
  t2i: ImageIcon, char3view: Users, storyboard: Clapperboard, i2v: Film, ref2v: Images,
  t2v: Video, a2v: AudioLines, upscale: Search, color: Palette, interp: FastForward, bg: Sun,
  // 通用 UI
  globe: Globe, save: Save, download: Download, upload: Upload, folderOpen: FolderOpen,
  panelLeftOpen: PanelLeftOpen, panelLeftClose: PanelLeftClose,
  play: Play, loader: Loader2, check: CheckCircle2, xCircle: XCircle, x: X,
};

export default function Icon({ name, size = 16, className, style }) {
  const C = MAP[name] || ImageIcon;
  return <C size={size} className={className} style={style} strokeWidth={2} />;
}
