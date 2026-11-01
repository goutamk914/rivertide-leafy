/**
 * A curved row of images streaming right to left around the inside of a cylinder.
 *
 * A CSS box can't bend, so each tile is cut into SLICES vertical strips, each a flat facet
 * showing its share of the image. The tile (preserve-3d) is what moves: one rotateY about the
 * cylinder's axis carries the whole tile along the arc. Only a tile's delay differs, which sets
 * where on the arc it sits. The band is transform-only on the compositor; the fade is a mask.
 */
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { cx } from '../../../ui/components';

const SLICES = 16;
const CAMERA = 1.6;

function arc(bend: number) {
  return (CAMERA - 1 + Math.cos(bend)) / (2 * CAMERA * Math.sin(bend));
}

const MAX_WIDTH = 55;

function measure(width: number, height: number, tile: number, aspect: number, gap: number, bend: number) {
  const h = Math.min((tile / 100) * height, ((MAX_WIDTH / 100) * width) / aspect);
  const radius = width * arc(bend);
  if (!(h > 0) || !(radius > 0)) return { columns: 2, sweep: 0, unit: 0, limit: 0 };
  const deg = (rad: number) => (rad * 180) / Math.PI;
  const unit = deg(h / radius);
  const pitch = (aspect + gap / 100) * unit;
  const limit = deg(bend) + (aspect * unit) / 2;
  const columns = Math.min(60, Math.max(2, Math.ceil((2 * limit) / pitch)));
  const round = (n: number) => +n.toFixed(4);
  const sweep = round((columns * pitch) / 2);
  return { columns, sweep, unit: round(unit), limit: round(Math.min(sweep, limit)) };
}

export interface TiltedGridImage {
  readonly src: string;
  /** Only used if you drop the decorative treatment; the band is aria-hidden. */
  readonly alt?: string;
}

export interface TiltedGridHeroProps {
  readonly images: readonly TiltedGridImage[];
  /** Seconds for the row to advance by one tile. */
  readonly speed?: number;
  /** Tile height, as a percentage of the hero's height. */
  readonly tileHeight?: number;
  /** Tile width divided by tile height. */
  readonly aspectRatio?: number;
  /** Space between tiles, as a percentage of a tile's height. */
  readonly gap?: number;
  /** Vertical centre of the row, as a percentage of the hero's height. */
  readonly axis?: number;
  /** How far the row has bent round by the frame's edge, in degrees. */
  readonly curve?: number;
  /** Width of the fade at each end, as a percentage of the hero's width. */
  readonly fade?: number;
  readonly children?: ReactNode;
  readonly className?: string;
}

export function TiltedGridHero({
  images,
  speed = 4,
  tileHeight = 26,
  aspectRatio = 16 / 9,
  gap = 6,
  axis = 56,
  curve = 80,
  fade = 12,
  children,
  className,
  ...props
}: ComponentProps<'div'> & TiltedGridHeroProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const orbit = `tgh-o-${id}`;
  const tile = `tgh-t-${id}`;
  const bend = (Math.min(85, Math.max(5, curve)) * Math.PI) / 180;

  const [layout, setLayout] = useState<ReturnType<typeof measure> | null>(null);
  const [shown, setShown] = useState<Record<number, number>>({});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const next = measure(width, height, tileHeight, aspectRatio, gap, bend);
      setLayout((prev) =>
        prev?.columns === next.columns && prev.sweep === next.sweep && prev.unit === next.unit ? prev : next,
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [tileHeight, aspectRatio, gap, bend]);

  // Fetch every image up front. A tile picks up its next one just before it comes back into view.
  useEffect(() => {
    for (const { src } of images) {
      const img = new Image();
      img.src = src;
    }
  }, [images]);

  const { columns, sweep, unit, limit } =
    layout ?? measure(1200, 560, tileHeight, aspectRatio, gap, bend);

  const u = (n: number) =>
    `calc(${+n.toFixed(4)} * min(${tileHeight}cqh, ${+(MAX_WIDTH / aspectRatio).toFixed(4)}cqw))`;

  const r = 100 * arc(bend);
  const radius = `${+r.toFixed(3)}cqw`;
  const turn = (deg: number) => `translateZ(${radius}) rotateY(${+deg.toFixed(4)}deg) translateZ(-${radius})`;

  const hide = +(((sweep - limit) / (2 * sweep || 1)) * 100).toFixed(4);
  const css =
    `@keyframes ${orbit}{` +
    `from{transform:${turn(-sweep)}}to{transform:${turn(sweep)}}` +
    `0%,${hide}%,${100 - hide}%,100%{visibility:hidden}` +
    `${hide + 0.001}%,${100 - hide - 0.001}%{visibility:visible}}` +
    `@media(prefers-reduced-motion:reduce){.${tile}{animation-play-state:paused}}`;

  const share = aspectRatio / SLICES;
  const duration = columns * speed;
  const mask = `linear-gradient(90deg,transparent,#000 ${fade}%,#000 ${100 - fade}%,transparent)`;

  return (
    <div
      ref={ref}
      className={cx('tgh', className)}
      {...props}
      style={{ containerType: 'size', ...props.style }}
    >
      <style>{css}</style>

      <div
        aria-hidden
        className="tgh__band"
        style={{
          opacity: layout ? 1 : 0,
          perspective: `${+(r * CAMERA).toFixed(3)}cqw`,
          perspectiveOrigin: `50% ${axis}%`,
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      >
        {Array.from({ length: columns }, (_, t) => {
          const first = columns - 1 - t;
          const img = images[(shown[t] ?? first) % Math.max(images.length, 1)];
          return (
            <div
              key={t}
              className={cx(tile, 'tgh__tile')}
              style={{
                left: `calc(50% - ${u(aspectRatio / 2)})`,
                top: `calc(${axis}% - ${u(0.5)})`,
                width: u(aspectRatio),
                height: u(1),
                transformStyle: 'preserve-3d',
                animation: `${orbit} ${duration}s linear ${-t * speed}s infinite`,
              }}
              onAnimationIteration={(e) => {
                const lap = Math.round(e.elapsedTime / duration);
                setShown((prev) => {
                  const next = lap * columns + first;
                  return prev[t] === next ? prev : { ...prev, [t]: next };
                });
              }}
            >
              {Array.from({ length: SLICES }, (_, k) => (
                <div
                  key={k}
                  className={cx(
                    'tgh__slice',
                    k === 0 && 'tgh__slice--first',
                    k === SLICES - 1 && 'tgh__slice--last',
                  )}
                  style={{
                    left: u((aspectRatio - share) / 2),
                    width: k === SLICES - 1 ? u(share) : `calc(${u(share)} + 1px)`,
                    height: u(1),
                    transform: turn((aspectRatio / 2 - (k + 0.5) * share) * unit),
                  }}
                >
                  {img ? (
                    <img
                      src={img.src}
                      alt={k === 0 ? (img.alt ?? '') : ''}
                      draggable={false}
                      className="tgh__img"
                      style={{
                        left: u(-k * share),
                        width: u(aspectRatio),
                        height: u(1),
                      }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {children}
    </div>
  );
}
