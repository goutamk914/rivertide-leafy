import { Brain, ChartLine, FileText, History, House, MessageCircle, NotebookPen, Settings, type LucideIcon } from 'lucide-react';
import type { RouteName } from '../../lib/router';

export interface NavItem {
  readonly name: RouteName;
  readonly label: string;
  readonly path: string;
  readonly icon: LucideIcon;
  /** Still shown when calm mode trims the sidebar. */
  readonly essential: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { name: 'home', label: 'Today', path: '/', icon: House, essential: true },
  { name: 'history', label: 'History', path: '/history', icon: History, essential: true },
  { name: 'chat', label: 'Chat', path: '/chat', icon: MessageCircle, essential: true },
  { name: 'knowledge', label: 'Knowledge', path: '/knowledge', icon: Brain, essential: false },
  { name: 'documents', label: 'Documents', path: '/documents', icon: FileText, essential: false },
  { name: 'notes', label: 'Notes & reminders', path: '/notes', icon: NotebookPen, essential: false },
  { name: 'insights', label: 'Insights', path: '/insights', icon: ChartLine, essential: false },
  { name: 'settings', label: 'Settings', path: '/settings', icon: Settings, essential: true },
];

export function visibleNav(calm: boolean): readonly NavItem[] {
  return calm ? NAV_ITEMS.filter((item) => item.essential) : NAV_ITEMS;
}
