import {
  AppWindow, Battery, Bell, BellOff, BookOpen, BookmarkPlus, Brain, Calculator, Calendar, Camera, Clipboard,
  ClipboardCopy, Clock, CloudSun, Command, File, FileSearch, FileText, Folder, FolderOpen, Gauge, Globe, Hash,
  Heart, History, Image, Info, Keyboard, Leaf, Lightbulb, Link, List, ListChecks, Lock, Mail, MessageCircle, Mic,
  Monitor, MonitorOff, Moon, Music, NotebookPen, Play, Power, Search, Settings, SlidersHorizontal, Sparkles, Star,
  StickyNote, Sun, Terminal, Timer, Trash2, Volume2, Workflow, Zap, type LucideIcon,
} from 'lucide-react';
import type { IconName } from './iconNames';

const ICONS: Readonly<Record<IconName, LucideIcon>> = {
  'app-window': AppWindow, battery: Battery, bell: Bell, 'bell-off': BellOff, 'book-open': BookOpen,
  'bookmark-plus': BookmarkPlus, brain: Brain, calculator: Calculator, calendar: Calendar, camera: Camera,
  clipboard: Clipboard, 'clipboard-copy': ClipboardCopy, clock: Clock, 'cloud-sun': CloudSun, command: Command,
  file: File, 'file-search': FileSearch, 'file-text': FileText, folder: Folder, 'folder-open': FolderOpen,
  gauge: Gauge, globe: Globe, hash: Hash, heart: Heart, history: History, image: Image, info: Info,
  keyboard: Keyboard, leaf: Leaf, lightbulb: Lightbulb, link: Link, list: List, 'list-checks': ListChecks,
  lock: Lock, mail: Mail, 'message-circle': MessageCircle, mic: Mic, monitor: Monitor, 'monitor-off': MonitorOff,
  moon: Moon, music: Music, 'notebook-pen': NotebookPen, play: Play, power: Power, search: Search,
  settings: Settings, 'sliders-horizontal': SlidersHorizontal, sparkles: Sparkles, star: Star,
  'sticky-note': StickyNote, sun: Sun, terminal: Terminal, timer: Timer, 'trash-2': Trash2, 'volume-2': Volume2,
  workflow: Workflow, zap: Zap,
};

export interface IconProps {
  readonly name: IconName;
  readonly size?: number;
  readonly strokeWidth?: number;
  readonly className?: string;
}

/** A lucide icon from the curated overlay set. Always decorative: label the control around it. */
export function Icon({ name, size = 18, strokeWidth = 1.75, className }: IconProps) {
  const Component = ICONS[name];
  return <Component size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" focusable="false" />;
}
