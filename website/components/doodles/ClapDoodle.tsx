import { Doodle, Stroke } from './Doodle';

/** Two hands meeting, with the little lines a clap makes. Stands in for a double-clap emoji. */
export function ClapDoodle({ className }: { readonly className?: string }) {
  return (
    <Doodle viewBox="0 0 120 84" className={className} strokeWidth={2.6}>
      <Stroke order={0} d="M36 76 Q26 58 31 40 Q34 29 42 30 Q49 31 50 41 L52 66 Q50 76 42 77 Q38 77 36 76 Z" />
      <Stroke order={1} d="M37 33 L36 21 Q37 16 41 17 Q44 18 44 23 L45 31 M44 24 L46 14 Q48 10 51 12 Q53 14 52 18 L50 34" />
      <Stroke order={2} d="M84 76 Q94 58 89 40 Q86 29 78 30 Q71 31 70 41 L68 66 Q70 76 78 77 Q82 77 84 76 Z" />
      <Stroke order={3} d="M83 33 L84 21 Q83 16 79 17 Q76 18 76 23 L75 31 M76 24 L74 14 Q72 10 69 12 Q67 14 68 18 L70 34" />
      <Stroke order={4} accent d="M60 8 L60 19 M47 6 L51 15 M73 6 L69 15" />
    </Doodle>
  );
}
