import {
  FileText, ScrollText, Image as ImageIcon, Film, Video, AudioLines,
  Users, Clapperboard, Images, Search, Palette, FastForward, Sun, ImagePlus,
  Globe, Save, Download, Upload, FolderOpen, PanelLeftClose, PanelLeftOpen, Play,
  Loader2, CheckCircle2, XCircle, X, Copy, LayoutGrid, Edit3, Trash2, Maximize, Group, Ungroup,
  RefreshCw, ChevronLeft, ChevronRight, Plus, ZoomIn, ZoomOut, Fullscreen, Lock, Unlock, HelpCircle, Settings,
} from 'lucide-react';

// 语义名 → Lucide 组件（覆盖基础资产 kind、AI 工具 id、通用 UI 动作）
const MAP = {
  // 基础资产节点
  text: FileText, script: ScrollText, image: ImageIcon, video: Film, audio: AudioLines,
  // AI 工具（与 server/tools.js 的 tool.icon 一致）
  t2i: ImageIcon, char3view: Users, storyboard: Clapperboard, i2v: Film, ref2v: Images,
  ref2i: ImagePlus,
  t2v: Video, a2v: AudioLines, upscale: Search, color: Palette, interp: FastForward, bg: Sun,
  // 通用 UI
  globe: Globe, save: Save, download: Download, upload: Upload, folderOpen: FolderOpen,
  panelLeftOpen: PanelLeftOpen, panelLeftClose: PanelLeftClose,
  play: Play, loader: Loader2, check: CheckCircle2, xCircle: XCircle, x: X,
  // 右键菜单 / 编组
  copy: Copy, grid: LayoutGrid, film: Film, edit: Edit3, trash: Trash2,
  maximize: Maximize, group: Group, ungroup: Ungroup,
  refreshCw: RefreshCw, chevronLeft: ChevronLeft, chevronRight: ChevronRight,
  plus: Plus, zoomIn: ZoomIn, zoomOut: ZoomOut, fullscreen: Fullscreen,
  lock: Lock, unlock: Unlock, helpCircle: HelpCircle, settings: Settings,
};

export default function Icon({ name, size = 16, className, style }) {
  const C = MAP[name] || ImageIcon;
  return <C size={size} className={className} style={style} strokeWidth={2} />;
}
