import { FAQS } from '@/content/faq';
import { FaqList } from '@/components/site/FaqList';

export function Faq() {
  return (
    <section className="rt-section" data-chapter="Questions" aria-labelledby="faq-title">
      <div className="rt-container faq">
        <h2 id="faq-title" className="rt-h2 faq__title rt-reveal">
          Questions.<br /> <span className="rt-beat">Straight answers.</span>
        </h2>
        <div className="rt-reveal">
          <FaqList items={FAQS} />
        </div>
      </div>
    </section>
  );
}
