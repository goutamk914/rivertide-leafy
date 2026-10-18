import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LeafySprite, type PoseName } from '@rivertide/leafy';
import { ICON_STROKE } from './Button';
import { cx } from './cx';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly as?: ElementType;
  readonly padding?: 'normal' | 'tight' | 'flush';
  readonly tone?: 'raised' | 'sunken';
  readonly interactive?: boolean;
}

/** Tonal surface, radius 18, no border. */
export function Card({ as: Tag = 'div', padding = 'normal', tone = 'raised', interactive, className, ...rest }: CardProps) {
  return (
    <Tag
      className={cx('rt-card', padding !== 'normal' && `rt-card--${padding}`, tone === 'sunken' && 'rt-card--sunken', interactive && 'rt-card--interactive', className)}
      {...rest}
    />
  );
}

export interface SectionHeaderProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  /** Heading level; defaults to h2. */
  readonly level?: 2 | 3;
  readonly id?: string;
}

export function SectionHeader({ title, description, actions, level = 2, id }: SectionHeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="rt-section-head">
      <div className="rt-section-head__text">
        <Heading id={id} className="rt-section-head__title">{title}</Heading>
        {description ? <p className="rt-section-head__description">{description}</p> : null}
      </div>
      {actions ? <div className="rt-section-head__actions">{actions}</div> : null}
    </div>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'ask' | 'info' | 'warn' | 'danger';

export function Badge({ tone = 'neutral', icon: Icon, children }: { readonly tone?: BadgeTone; readonly icon?: LucideIcon; readonly children: ReactNode }) {
  return (
    <span className={cx('rt-badge', tone !== 'neutral' && `rt-badge--${tone}`)}>
      {Icon ? <Icon size={13} strokeWidth={ICON_STROKE} aria-hidden /> : null}
      {children}
    </span>
  );
}

export interface SkeletonProps {
  readonly width?: number | string;
  readonly height?: number | string;
  readonly radius?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** Shape placeholder while content loads. Pair a group of these with one aria-busy container. */
export function Skeleton({ width = '100%', height = 16, radius, className, style }: SkeletonProps) {
  return <span aria-hidden className={cx('rt-skeleton', className)} style={{ width, height, borderRadius: radius, ...style }} />;
}

export function SkeletonList({ rows = 4, height = 56, label = 'Loading' }: { readonly rows?: number; readonly height?: number; readonly label?: string }) {
  return (
    <div role="status" aria-label={label} style={{ display: 'grid', gap: 8 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius={14} />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  readonly pose?: PoseName;
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
  readonly compact?: boolean;
}

/** Leafy pose + one sentence + one action. */
export function EmptyState({ pose = 'peek-curious', title, children, action, compact }: EmptyStateProps) {
  return (
    <div className="rt-empty" style={compact ? { padding: '24px 16px' } : undefined}>
      <LeafySprite pose={pose} scale={compact ? 3 : 4} decorative />
      <p className="rt-empty__title">{title}</p>
      {children ? <p className="rt-empty__text">{children}</p> : null}
      {action ? <div className="rt-empty__action">{action}</div> : null}
    </div>
  );
}
