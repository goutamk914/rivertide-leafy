import { Plus } from 'lucide-react';
import type { Faq } from '@/content/faq';

/** Native disclosure rows: keyboard and screen reader support for free, and they work without JS. */
export function FaqList({ items }: { readonly items: readonly Faq[] }) {
  return (
    <div className="faq__list">
      {items.map((item) => (
        <details key={item.question} className="rt-disclosure">
          <summary>
            {item.question}
            <span className="rt-disclosure__icon" aria-hidden="true">
              <Plus size={16} strokeWidth={1.75} />
            </span>
          </summary>
          <p className="rt-disclosure__body">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
