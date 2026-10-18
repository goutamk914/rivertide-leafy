/** Layout pieces shared by every Settings section: the section frame, tonal groups and labelled rows. */
import { useId, type ReactNode } from 'react';
import { Card, SectionHeader, SegmentedControl, cx, type SegmentOption } from '../../../../ui/components';

export interface SectionFrameProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
}

/** One Settings section: an h2 and its groups. */
export function SectionFrame({ title, description, children }: SectionFrameProps) {
  const id = useId();
  return (
    <section className="settings-section" aria-labelledby={id}>
      <SectionHeader id={id} title={title} description={description} />
      {children}
    </section>
  );
}

export interface SettingGroupProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  /** false renders the heading and body without a card (for groups that hold their own cards). */
  readonly surface?: boolean;
  readonly children: ReactNode;
}

/** A titled group of related settings (h3), on a tonal card by default. */
export function SettingGroup({ title, description, actions, surface = true, children }: SettingGroupProps) {
  const id = useId();
  const content = (
    <>
      <div className="settings-group__head">
        <div>
          <h3 id={id} className="settings-group__title">{title}</h3>
          {description ? <p className="settings-group__description">{description}</p> : null}
        </div>
        {actions ? <div className="settings-group__actions">{actions}</div> : null}
      </div>
      <div className="settings-group__body">{children}</div>
    </>
  );
  return surface ? (
    <Card className="settings-group" role="group" aria-labelledby={id}>
      {content}
    </Card>
  ) : (
    <div className={cx('settings-group', 'settings-group--plain')} role="group" aria-labelledby={id}>
      {content}
    </div>
  );
}

export interface ChoiceRowProps<T extends string> {
  readonly label: string;
  readonly description?: ReactNode;
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}

/** A visible label (and optional explanation) beside a segmented control. */
export function ChoiceRow<T extends string>({ label, description, options, value, onChange }: ChoiceRowProps<T>) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <span className="settings-row__label" aria-hidden>{label}</span>
        {description ? <p className="settings-row__description">{description}</p> : null}
      </div>
      <SegmentedControl label={label} options={options} value={value} onChange={onChange} />
    </div>
  );
}

/** Small explanatory paragraph inside a group. */
export function SettingNote({ children, tone }: { readonly children: ReactNode; readonly tone?: 'warn' }) {
  return <p className={cx('settings-note', tone === 'warn' && 'settings-note--warn')}>{children}</p>;
}
