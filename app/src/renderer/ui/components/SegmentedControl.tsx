import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { ICON_STROKE } from './Button';
import { cx } from './cx';

export const SPRING = { type: 'spring', bounce: 0, duration: 0.4 } as const;

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: LucideIcon;
  readonly count?: number;
  readonly disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** Accessible name for the group. */
  readonly label: string;
  /** `radio` for filters, `tabs` when it switches panels (pair with <TabPanel idBase>). */
  readonly mode?: 'radio' | 'tabs';
  /** Required with `mode="tabs"`: shared with TabPanel to wire aria-controls. */
  readonly idBase?: string;
  readonly block?: boolean;
  readonly className?: string;
}

export const tabId = (idBase: string, value: string) => `${idBase}-tab-${value}`;
export const panelId = (idBase: string, value: string) => `${idBase}-panel-${value}`;

/** Sunken track with a raised thumb that slides (shared layoutId spring) to the chosen option. */
export function SegmentedControl<T extends string>({
  options, value, onChange, label, mode = 'radio', idBase, block, className,
}: SegmentedControlProps<T>) {
  const uid = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((o) => !o.disabled);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let target: SegmentOption<T> | undefined;
    if (event.key in keys) {
      const current = enabled.findIndex((o) => o.value === options[index]?.value);
      target = enabled[(current + (keys[event.key] ?? 0) + enabled.length) % enabled.length];
    } else if (event.key === 'Home') {
      target = enabled[0];
    } else if (event.key === 'End') {
      target = enabled[enabled.length - 1];
    }
    if (!target) return;
    event.preventDefault();
    onChange(target.value);
    refs.current[options.indexOf(target)]?.focus();
  };

  const isTabs = mode === 'tabs';
  return (
    <div
      role={isTabs ? 'tablist' : 'radiogroup'}
      aria-label={label}
      className={cx('rt-segmented', block && 'rt-segmented--block', className)}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        const Icon = option.icon;
        const content: ReactNode = (
          <span className="rt-segmented__label">
            {Icon ? <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden /> : null}
            {option.label}
            {option.count !== undefined ? <span className="tabular muted">{option.count}</span> : null}
          </span>
        );
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role={isTabs ? 'tab' : 'radio'}
            id={isTabs && idBase ? tabId(idBase, option.value) : undefined}
            aria-controls={isTabs && idBase ? panelId(idBase, option.value) : undefined}
            aria-selected={isTabs ? selected : undefined}
            aria-checked={isTabs ? undefined : selected}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            className="rt-segmented__item"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
          >
            {selected ? <motion.span layoutId={`${uid}-thumb`} className="rt-segmented__thumb" transition={SPRING} /> : null}
            {content}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  readonly idBase: string;
  readonly value: string;
  readonly children: ReactNode;
  readonly className?: string;
}

/** The panel a `mode="tabs"` SegmentedControl switches. Render only the active one. */
export function TabPanel({ idBase, value, children, className }: TabPanelProps) {
  return (
    <div role="tabpanel" id={panelId(idBase, value)} aria-labelledby={tabId(idBase, value)} tabIndex={0} className={cx('rt-tabpanel', className)}>
      {children}
    </div>
  );
}
