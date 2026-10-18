/** Pure resolution of a search result's `icon` field into something safe to render. */
import type { SearchKind } from '@shared/types';
import { kindIconName, normalizeIconName, type IconName } from '../lib/hooks/iconNames';

export type ResolvedIcon = { readonly type: 'image'; readonly src: string } | { readonly type: 'icon'; readonly name: IconName };

/** App icons arrive as base64 raster/SVG data URLs; anything else is ignored. 1.5 MB cap. */
const DATA_IMAGE = /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_DATA_URL = 1_500_000;

export function isSafeDataImage(value: string): boolean {
  return value.length <= MAX_DATA_URL && DATA_IMAGE.test(value);
}

/** `data:` image → image; `icon:<lucide-name>` → that icon; otherwise the kind's icon. */
export function resolveResultIcon(icon: string | null, kind: SearchKind): ResolvedIcon {
  if (icon && icon.startsWith('data:') && isSafeDataImage(icon)) return { type: 'image', src: icon };
  if (icon && icon.startsWith('icon:')) {
    const name = normalizeIconName(icon);
    if (name) return { type: 'icon', name };
  }
  return { type: 'icon', name: kindIconName(kind) };
}
