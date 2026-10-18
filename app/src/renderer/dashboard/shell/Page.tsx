import type { ReactNode } from 'react';
import { CircleAlert, RotateCcw } from 'lucide-react';
import type { Route } from '../../lib/router';
import { Button, ICON_STROKE, cx } from '../../ui/components';

export const PAGE_TITLE_ID = 'page-title';

/** Props every routed page receives. */
export interface PageComponentProps {
  readonly route: Route;
}

export interface PageProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  /** `split` pages manage their own scrolling panes; `scroll` pages scroll as a whole. */
  readonly layout?: 'scroll' | 'split';
  readonly children: ReactNode;
}

/** Page frame: one h1 (focused on navigation for screen readers), optional actions, then content. */
export function Page({ title, description, actions, layout = 'scroll', children }: PageProps) {
  return (
    <div className={cx('page', layout === 'scroll' ? 'page--scroll' : 'page--split')}>
      <div className="page__inner">
        <header className="page__head">
          <div>
            <h1 id={PAGE_TITLE_ID} className="page__title" tabIndex={-1}>
              {title}
            </h1>
            {description ? <p className="page__description">{description}</p> : null}
          </div>
          {actions ? <div className="page__actions">{actions}</div> : null}
        </header>
        {children}
      </div>
    </div>
  );
}

/** Inline load error with a retry. */
export function PageError({ message, onRetry }: { readonly message: string; readonly onRetry?: () => void }) {
  return (
    <div className="page-error" role="alert">
      <CircleAlert size={20} strokeWidth={ICON_STROKE} aria-hidden />
      <p>{message}</p>
      {onRetry ? (
        <Button size="sm" icon={RotateCcw} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
