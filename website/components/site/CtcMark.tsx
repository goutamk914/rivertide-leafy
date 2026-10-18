import ctcLeaf from '@/assets/code-the-cure.svg';

/**
 * Code the Cure's two-leaf mark. Imported statically so the URL carries the base path;
 * on dark surfaces it sits on a white disc (`.rt-ctc-disc`), as on codethecure.org.
 */
export function CtcMark({ className }: { readonly className?: string }) {
  return <img src={ctcLeaf.src} width={24} height={24} alt="" className={className} decoding="async" />;
}
