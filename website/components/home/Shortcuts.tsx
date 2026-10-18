import { SHORTCUTS } from '@/content/shortcuts';
import { Keys } from '@/components/site/Keys';

/** A cheat sheet you could print: every way in, as keycaps. */
export function Shortcuts() {
  return (
    <section className="rt-section" data-chapter="Shortcuts" aria-labelledby="shortcuts-title">
      <div className="rt-container">
        <h2 id="shortcuts-title" className="rt-h2 rt-reveal">
          Eight shortcuts.<br /> <span className="rt-beat">You only need the first.</span>
        </h2>
        <ul className="sheet rt-panel rt-reveal">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.action} className="sheet__item">
              <Keys keys={shortcut.keys} joiner={shortcut.joiner} className="sheet__keys" />
              <h3 className="sheet__action">{shortcut.action}</h3>
              <p className="sheet__detail">{shortcut.detail}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
