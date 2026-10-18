import { PaceChart } from './PaceChart';

/** Speech dynamics, told plainly: what is measured, against whom, and what it is not. */
export function FoggySignal() {
  return (
    <section className="rt-section" data-chapter="Foggy days" aria-labelledby="foggy-title">
      <div className="rt-container foggy">
        <div className="foggy__chart rt-panel rt-reveal">
          <PaceChart />
        </div>
        <div className="foggy__copy">
          <h2 id="foggy-title" className="rt-h2 rt-reveal">
            Notices foggy days.<br /> <span className="rt-beat">Not a diagnosis. A gentle signal.</span>
          </h2>
          <p className="rt-body rt-reveal foggy__body">
            Rivertide measures your own speech, never the AI’s writing: how fast you talk, how often you pause, how many ums
            and restarts. Each day is compared with your usual over the last two weeks.
          </p>
          <p className="rt-body rt-reveal foggy__body">
            In Insights it reads as steady, a little foggy, or foggy, with the numbers behind it. What you do with that is up
            to you.
          </p>
        </div>
      </div>
    </section>
  );
}
