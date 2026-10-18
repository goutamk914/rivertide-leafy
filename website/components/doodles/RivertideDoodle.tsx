import { Doodle, Stroke } from './Doodle';

/**
 * Code the Cure's own Rivertide doodle (HomeDoodle kind="rivertide" on codethecure.org):
 * a microphone with sound around it, an arrow, and a checked-off list.
 */
export function RivertideDoodle({ className }: { readonly className?: string }) {
  return (
    <Doodle viewBox="0 0 320 190" className={className}>
      <Stroke order={0} d="M20 169 Q157 165 299 170" />
      <Stroke
        order={1}
        d="M58 64 Q56 46 72 45 Q88 44 88 63 L88 98 Q88 115 73 115 Q58 115 58 98 Z M47 91 Q43 127 73 129 Q105 129 102 91 M73 130 L73 149 M57 151 Q72 147 90 151"
      />
      <Stroke order={2} accent d="M30 67 Q20 83 30 101 M115 66 Q125 83 114 103 M19 58 Q3 83 18 111 M127 57 Q144 83 128 112" />
      <Stroke order={3} accent d="M151 86 Q166 82 181 86 M174 78 L183 86 L174 94" />
      <Stroke
        order={4}
        d="M204 38 Q242 34 280 39 L281 144 Q245 149 203 144 Z M223 30 Q242 26 263 31 L263 46 L222 46 Z M219 68 L226 75 L237 61 M248 68 L267 68 M218 96 L225 103 L236 88 M246 96 L265 95 M218 122 L225 129 L236 114 M247 122 L265 121"
      />
      <Stroke order={5} accent d="M153 35 L153 47 M147 41 L159 41" />
    </Doodle>
  );
}
