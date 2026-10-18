import type { Metadata } from 'next';
import Link from 'next/link';
import { DownloadButton } from '@/components/site/Buttons';
import { CodeBlock } from '@/components/site/CodeBlock';
import { Keys } from '@/components/site/Keys';
import { PERMISSIONS } from '@/content/privacy';
import { REPO_URL } from '@/lib/site';
import { pageMetadata } from '@/lib/metadata';

export const metadata: Metadata = pageMetadata({
  title: 'Install guide',
  description: 'Download Rivertide for Mac, allow the three permissions it needs, free up the globe key, and say your first sentence. Or build it from source.',
  path: '/download/',
});

const FIRST_RUN = PERMISSIONS.filter((permission) => permission.name !== 'Automation');

const SOURCE_COMMANDS = [
  `git clone ${REPO_URL}.git`,
  'cd rivertide-electron',
  'npm install',
  'npm run app:dev',
];

const STEPS = [
  {
    title: 'Download',
    body: 'Get the latest .dmg from the releases page on GitHub. It is free, with no account and no trial.',
  },
  {
    title: 'Install',
    body: 'Open the .dmg and drag Rivertide into Applications. If macOS blocks the first launch, open System Settings, then Privacy & Security, and choose Open Anyway.',
  },
  {
    title: 'Allow three things',
    body: 'Rivertide walks you through these on first launch. Each one has a plain reason:',
    permissions: true,
  },
  {
    title: 'Free up the globe key',
    body: 'In System Settings, open Keyboard and set “Press globe key to” to “Do Nothing”. Then holding fn talks to Rivertide instead of opening the emoji picker.',
  },
  {
    title: 'Pick your AI',
    body: 'Paste a key for Claude, Groq, OpenAI or OpenRouter. Or point Rivertide at Ollama and whisper.cpp on your Mac and stay fully offline.',
  },
  {
    title: 'Say your first sentence',
    body: 'Click into any text box, hold fn, talk, and let go.',
    keys: true,
  },
] as const;

export default function DownloadPage() {
  return (
    <main id="main">
      <section className="rt-section download-intro" aria-labelledby="download-title">
        <div className="rt-container">
          <h1 id="download-title" className="rt-display hero__title rt-unblur">
            Get Rivertide.
            <br />
            <span className="rt-beat">Free, for your Mac.</span>
          </h1>
          <p className="rt-lede download-intro__lede">You need macOS 13 Ventura or later and a microphone. The app walks you through the rest.</p>
          <div className="hero__actions">
            <DownloadButton />
          </div>
        </div>
      </section>

      <section className="rt-section download-steps" data-chapter="Setting up" aria-labelledby="steps-title">
        <div className="rt-container">
          <h2 id="steps-title" className="rt-h2 rt-reveal">
            Six steps.
            <br />
            <span className="rt-beat">You only do them once.</span>
          </h2>
          <ol className="steps">
            {STEPS.map((step) => (
              <li key={step.title} className="steps__item rt-reveal">
                <h3 className="rt-h3">{step.title}</h3>
                <p className="rt-body steps__body">{step.body}</p>
                {'permissions' in step ? (
                  <ul className="steps__permissions">
                    {FIRST_RUN.map((permission) => (
                      <li key={permission.name}>
                        <strong>{permission.name}.</strong> {permission.why}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {'keys' in step ? <Keys keys={['fn']} size="lg" className="steps__keys" /> : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="rt-section" data-chapter="Build from source" aria-labelledby="source-title">
        <div className="rt-container download-source">
          <div>
            <h2 id="source-title" className="rt-h2 rt-reveal">
              Build it yourself.
              <br />
              <span className="rt-beat">It is all open source.</span>
            </h2>
            <p className="rt-body download-source__body rt-reveal">
              You need Node.js 22.12 or later and Xcode Command Line Tools (for the small Swift helper that reads the fn key).
              Install those with <code className="inline-code">xcode-select --install</code>, then:
            </p>
          </div>
          <div className="rt-reveal">
            <CodeBlock label="Commands to build and run Rivertide from source" lines={SOURCE_COMMANDS} />
            <p className="rt-body download-source__body">
              To make your own .app, run <code className="inline-code">npm run dist -w app</code>. Windows and Linux builds are
              experimental: the fn key and pasting work differently there.
            </p>
          </div>
        </div>
      </section>

      <section className="rt-section download-next" aria-labelledby="next-title">
        <div className="rt-container">
          <h2 id="next-title" className="rt-h2 rt-reveal">
            Questions first?
            <br />
            <span className="rt-beat">Read where your words go.</span>
          </h2>
          <p className="download-next__links rt-reveal">
            <Link href="/privacy/" className="rt-inline-link">
              Privacy, in plain words
            </Link>
            <Link href="/leafy/" className="rt-inline-link">
              Meet Leafy
            </Link>
            <a href={`${REPO_URL}/issues`} className="rt-inline-link">
              Ask on GitHub
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
