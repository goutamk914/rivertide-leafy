import type { Metadata } from 'next';
import { DataFlowTable } from '@/components/privacy/DataFlowTable';
import { PERMISSIONS } from '@/content/privacy';
import { REPO_URL } from '@/lib/site';
import { pageMetadata } from '@/lib/metadata';

export const metadata: Metadata = pageMetadata({
  title: 'Privacy',
  description: 'Where Rivertide sends your voice and words, what stays on your Mac, and why it asks for each macOS permission. In plain words.',
  path: '/privacy/',
});

const NEVER = [
  'There is no Rivertide account, so there is nothing to sign in to and nothing for us to lose.',
  'Nothing you say is sent to Code the Cure. We have no server for it to go to.',
  'Audio is not kept after it is turned into text, unless you switch on “Keep recordings”.',
  'Your API keys are never shown to the windows you see. Only the part of the app that talks to your provider can read them.',
];

export default function PrivacyPage() {
  return (
    <main id="main" className="paper privacy-page">
      <section className="rt-section privacy-page__intro" aria-labelledby="privacy-page-title">
        <div className="rt-container">
          <h1 id="privacy-page-title" className="rt-display hero__title rt-unblur">
            Privacy, in plain words.
            <br />
            <span className="rt-beat">What goes where, and why.</span>
          </h1>
          <p className="rt-lede privacy-page__lede">
            Rivertide is built so the private parts of your life stay on your Mac. When something has to leave it, it goes to a
            service you picked, with your own key, and you can choose to keep everything local instead.
          </p>
        </div>
      </section>

      <section className="privacy-page__section" data-chapter="Where it goes" aria-labelledby="flows-title">
        <div className="rt-container">
          <h2 id="flows-title" className="rt-h2">Where each thing goes</h2>
          <div className="privacy-page__table">
            <DataFlowTable caption="Where Rivertide sends each kind of data" />
          </div>
          <p className="rt-body privacy-page__aside">
            If you ask Leafy about the weather, it asks Open-Meteo, a free public weather service that needs no account or key.
          </p>
        </div>
      </section>

      <section className="privacy-page__section" data-chapter="Permissions" aria-labelledby="permissions-title">
        <div className="rt-container">
          <h2 id="permissions-title" className="rt-h2">The permissions it asks for</h2>
          <p className="rt-body privacy-page__aside">
            macOS asks you for each of these. You can change your mind at any time in System Settings, Privacy &amp; Security.
          </p>
          <dl className="permissions">
            {PERMISSIONS.map((permission) => (
              <div key={permission.name} className="permissions__row">
                <dt className="rt-h3">{permission.name}</dt>
                <dd>
                  <p className="permissions__why">{permission.why}</p>
                  <p className="permissions__when">{permission.when}</p>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="privacy-page__section" data-chapter="What we never do" aria-labelledby="never-title">
        <div className="rt-container privacy-page__split">
          <h2 id="never-title" className="rt-h2">What never happens</h2>
          <ul className="never">
            {NEVER.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="privacy-page__section privacy-page__last" data-chapter="Your data" aria-labelledby="control-title">
        <div className="rt-container privacy-page__split">
          <h2 id="control-title" className="rt-h2">Taking it with you, or wiping it</h2>
          <div className="privacy-page__prose">
            <p className="rt-body">
              Everything Rivertide knows about you is a set of files in your Mac’s Application Support folder. Settings, Privacy
              has two buttons: export a copy of the folder, or wipe it. Uninstalling the app and deleting that folder removes it
              all.
            </p>
            <p className="rt-body">
              This website is a set of static pages on GitHub Pages. It sets no cookies and runs no analytics. GitHub, as the
              host, may keep ordinary server logs.
            </p>
            <p className="rt-body">
              Something here unclear, or not matching what the app does?{' '}
              <a href={`${REPO_URL}/issues`} className="rt-inline-link">
                Tell us on GitHub
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
