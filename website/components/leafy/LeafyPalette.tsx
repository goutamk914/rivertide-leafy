import { CornerDownLeft, FileText, Mic, Search, UserRound } from 'lucide-react';
import { LeafySprite } from '@rivertide/leafy';

const ICON = { size: 17, strokeWidth: 1.75, 'aria-hidden': true } as const;

const QUERY = 'Find the scan results from Dr. Rao';

interface ResultRow {
  readonly group: string;
  readonly icon: typeof FileText;
  readonly title: string;
  readonly meta: string;
}

const RESULTS: readonly ResultRow[] = [
  { group: 'Documents', icon: FileText, title: 'Scan results, Dr. Rao.pdf', meta: 'Added Sep 30' },
  { group: 'History', icon: Mic, title: '“Dr. Rao said the scan looked stable. Next one in three months.”', meta: 'You said this in Notes, Sep 30' },
  { group: 'Remembered', icon: UserRound, title: 'Dr. Rao is your oncologist', meta: 'From a conversation, Sep 12' },
];

/**
 * The Leafy palette as it appears in the app (⌘⇧Space): one search over documents, history and
 * everything Rivertide remembers, with "Ask Leafy" at the bottom. Example content.
 */
export function LeafyPalette() {
  return (
    <figure className="palette" aria-label={`Example: the Leafy palette searching for "${QUERY}"`}>
      <div className="palette__search">
        <Search {...ICON} size={19} />
        <span className="palette__query">
          {QUERY}
          <span className="rt-caret" aria-hidden="true" />
        </span>
        <kbd className="rt-kbd palette__esc">esc</kbd>
      </div>
      <ul className="palette__results">
        {RESULTS.map(({ group, icon: Icon, title, meta }, index) => (
          <li key={group} className="palette__item">
            <p className="palette__group">{group}</p>
            <div className={index === 0 ? 'palette__row is-active' : 'palette__row'}>
              <span className="palette__icon">
                <Icon {...ICON} />
              </span>
              <span className="palette__text">
                <span className="palette__title">{title}</span>
                <span className="palette__meta">{meta}</span>
              </span>
              {index === 0 ? <CornerDownLeft {...ICON} size={16} className="palette__enter" /> : null}
            </div>
          </li>
        ))}
      </ul>
      <div className="palette__ask">
        <LeafySprite mood="idle" scale={1} decorative />
        <span>
          Ask Leafy: <span className="palette__ask-query">“{QUERY}”</span>
        </span>
      </div>
    </figure>
  );
}
