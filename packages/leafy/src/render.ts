import { LEAFY, type Pose, type PosePack } from './poses';

const TRANSPARENT = '.';
const BODY = 'G';
const EYE_DARK = 'E';
const EYE_SHINE = 'W';
/** Face rows on the 24x28 grid where Leafy's eyes live (shared by every front-facing pose). */
const EYE_ROW_START = 17;
const EYE_ROW_END = 23;

export interface Frame {
  readonly pixels: readonly string[];
  /** Vertical body offset in grid pixels (negative = up). The ground shadow row never moves. */
  readonly offsetY: number;
}

/**
 * Returns a copy of the pose with Leafy's eyes closed: the top row of each eye becomes
 * body colour and the bottom row becomes a single dark lid line. Poses without the
 * standard two-row eyes (back-view, seed, closed-eye poses) come back unchanged.
 */
export function blinkPixels(pixels: readonly string[]): readonly string[] {
  const rows = pixels.map((row) => row.split(''));
  let changed = false;
  for (let y = EYE_ROW_START; y < Math.min(EYE_ROW_END, rows.length - 1); y += 1) {
    const row = rows[y];
    const below = rows[y + 1];
    for (let x = 0; x < row.length; x += 1) {
      const isEyeTop = (row[x] === EYE_DARK || row[x] === EYE_SHINE) && below[x] === EYE_DARK;
      if (!isEyeTop) continue;
      row[x] = BODY;
      below[x] = EYE_DARK;
      changed = true;
    }
  }
  return changed ? rows.map((row) => row.join('')) : pixels;
}

/** Shifts every row except the ground shadow by `offsetY` grid pixels, padding with transparency. */
export function shiftBody(pixels: readonly string[], offsetY: number): readonly string[] {
  if (offsetY === 0) return pixels;
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  const empty = TRANSPARENT.repeat(width);
  const shadow = pixels[height - 1];
  const body = pixels.slice(0, height - 1);
  const shifted = body.map((_, y) => body[y - offsetY] ?? empty);
  return [...shifted, shadow];
}

export function frameFromPose(pose: Pose, options: { blink?: boolean; offsetY?: number } = {}): Frame {
  const offsetY = options.offsetY ?? 0;
  const base = options.blink ? blinkPixels(pose.pixels) : pose.pixels;
  return { pixels: shiftBody(base, offsetY), offsetY };
}

export interface DrawOptions {
  /** CSS pixels per grid pixel. */
  readonly scale: number;
  /** Device pixel ratio used to keep edges crisp on HiDPI screens. */
  readonly dpr?: number;
  /** Optional palette override, e.g. a monochrome palette for a template icon. */
  readonly palette?: Readonly<Record<string, string>>;
  readonly pack?: PosePack;
}

/** Sizes the canvas for the pack and paints one frame with hard pixel edges. */
export function drawFrame(canvas: HTMLCanvasElement, frame: Frame, options: DrawOptions): void {
  const pack = options.pack ?? LEAFY;
  const dpr = Math.max(1, Math.round(options.dpr ?? 1));
  const cell = Math.max(1, Math.round(options.scale * dpr));
  const width = pack.width * cell;
  const height = pack.height * cell;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.style.width = `${width / dpr}px`;
  canvas.style.height = `${height / dpr}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  const palette = options.palette ?? pack.palette;
  frame.pixels.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const key = row[x];
      if (key === TRANSPARENT) continue;
      const color = palette[key];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  });
}

/** Renders a frame as an SVG string (one rect per horizontal run) for SSR, favicons and tray icons. */
export function frameToSvg(frame: Frame, options: { scale?: number; palette?: Readonly<Record<string, string>>; title?: string } = {}): string {
  const pack = LEAFY;
  const scale = options.scale ?? 1;
  const palette = options.palette ?? pack.palette;
  const rects: string[] = [];
  frame.pixels.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x];
      let run = 1;
      while (x + run < row.length && row[x + run] === key) run += 1;
      const color = palette[key];
      if (key !== TRANSPARENT && color) {
        rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${color}"/>`);
      }
      x += run;
    }
  });
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pack.width} ${pack.height}" width="${pack.width * scale}" height="${pack.height * scale}" shape-rendering="crispEdges">${title}${rects.join('')}</svg>`;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch] ?? ch);
}
