import { KnowledgeGraph } from './KnowledgeGraph';

const DETAILS = [
  {
    term: 'Documents',
    text: 'Add a discharge summary, a care plan or a letter. Leafy can find the line you need and answer questions about it.',
  },
  {
    term: 'Your dictionary',
    text: 'Names, medicines and places you say often are spelled right every time. Rivertide learns them as you fix them, or you add them yourself.',
  },
  {
    term: 'Your AI, your choice',
    text: 'Bring a key for Claude, Groq, OpenAI or OpenRouter. Or run everything on your Mac with Ollama and whisper.cpp.',
  },
] as const;

/** What Rivertide keeps track of, and where it keeps it. */
export function Remembers() {
  return (
    <section className="rt-section" data-chapter="Remembers for you" aria-labelledby="remembers-title">
      <div className="rt-container">
        <h2 id="remembers-title" className="rt-h2 rt-reveal">
          Remembers for you.<br /> <span className="rt-beat">So you don’t have to.</span>
        </h2>
        <p className="rt-lede rt-reveal remembers__lede">
          As you talk, Rivertide notes the people, medicines, appointments and symptoms you mention, and links them. Ask about
          any of it later.
        </p>

        <KnowledgeGraph />

        <dl className="remembers__details">
          {DETAILS.map((detail) => (
            <div key={detail.term} className="remembers__detail rt-reveal">
              <dt className="rt-h3">{detail.term}</dt>
              <dd className="rt-body">{detail.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
