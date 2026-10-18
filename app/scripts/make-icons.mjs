#!/usr/bin/env node
/**
 * Renders Leafy from the pose pack into the app's icons (zero dependencies):
 *   resources/icon.png              1024×1024 · 'happy' pose on a #0b0c0b rounded square (macOS grid)
 *   resources/trayTemplate(@2x).png 16 / 32 px · black silhouette on transparent (macOS template image)
 *   resources/tray(@2x).png         16 / 32 px · full colour (Windows / Linux)
 * Pixel art is scaled by whole numbers only (nearest neighbour), so edges stay crisp.
 *
 * Usage: node scripts/make-icons.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blendPixel, createImage, encodePng, parseHexColor, roundedRectCoverage } from './png.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(SCRIPT_DIR, '..');
export const POSES_PATH = resolve(APP_DIR, '../packages/leafy/src/data/leafy-poses.json');
const OUT_DIR = join(APP_DIR, 'resources');

const ICON_SIZE = 1024;
/** macOS Big Sur+ icon grid: an 824 px body inset 100 px, corner radius ≈ 22.5 %. */
const ICON_BODY = { x: 100, y: 100, size: 824, radius: 185 };
const ICON_BACKGROUND = '#0b0c0b';
const ICON_POSE = 'happy';
const ICON_SCALE = 28;

const TRAY_POSE = 'happy';
const TRAY_SIZE = 16;
const TRANSPARENT = '.';
const SHADOW_KEY = 'K';
const EYE_KEYS = new Set(['E', 'W']);
const FEET_ROW_COUNT = 1;

export function loadPosePack(path = POSES_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw.poses) || typeof raw.palette !== 'object') throw new Error('Pose pack has no poses or palette');
  return raw;
}

export function findPose(pack, name) {
  const pose = pack.poses.find((p) => p.name === name);
  if (!pose) throw new Error(`Pose "${name}" is not in the pose pack`);
  return pose;
}

/** Bounding box of the pixels for which `include(key)` is true. */
export function boundingBox(pixels, include) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  pixels.forEach((row, y) => {
    [...row].forEach((key, x) => {
      if (!include(key)) return;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
  });
  if (minX === Infinity) throw new Error('Pose has no visible pixels');
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Paints `pixels[crop]` at (left, top) with `scale` device pixels per grid pixel.
 * `colorOf(key)` returns an [r,g,b,a] tuple or null to skip the pixel.
 */
export function paintPixels(image, pixels, options) {
  const { crop, left, top, scale, colorOf } = options;
  for (let gy = 0; gy < crop.height; gy += 1) {
    const row = pixels[crop.y + gy];
    for (let gx = 0; gx < crop.width; gx += 1) {
      const rgba = colorOf(row[crop.x + gx]);
      if (!rgba) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) blendPixel(image, left + gx * scale + dx, top + gy * scale + dy, rgba);
      }
    }
  }
}

const paletteColor = (palette) => (key) =>
  key === TRANSPARENT || !palette[key] ? null : parseHexColor(palette[key]);

export function renderAppIcon(pack) {
  const image = createImage(ICON_SIZE, ICON_SIZE);
  const background = parseHexColor(ICON_BACKGROUND);
  for (let y = 0; y < ICON_SIZE; y += 1) {
    for (let x = 0; x < ICON_SIZE; x += 1) {
      const coverage = roundedRectCoverage(x, y, ICON_BODY);
      if (coverage > 0) blendPixel(image, x, y, background, coverage);
    }
  }
  const pose = findPose(pack, ICON_POSE);
  const crop = boundingBox(pose.pixels, (key) => key !== TRANSPARENT);
  const left = Math.round((ICON_SIZE - crop.width * ICON_SCALE) / 2);
  const top = Math.round((ICON_SIZE - crop.height * ICON_SCALE) / 2);
  paintPixels(image, pose.pixels, { crop, left, top, scale: ICON_SCALE, colorOf: paletteColor(pack.palette) });
  return image;
}

/** Leafy's leaves, head and body without the ground shadow and feet: 14×16 grid pixels, fits 16 px. */
export function trayCrop(pose) {
  const body = boundingBox(pose.pixels, (key) => key !== TRANSPARENT && key !== SHADOW_KEY);
  return { ...body, height: Math.min(body.height - FEET_ROW_COUNT, TRAY_SIZE) };
}

/** `template`: black silhouette with the eyes cut out (macOS tints template images itself). */
export function renderTrayIcon(pack, scale, template) {
  const size = TRAY_SIZE * scale;
  const image = createImage(size, size);
  const pose = findPose(pack, TRAY_POSE);
  const crop = trayCrop(pose);
  const black = [0, 0, 0, 255];
  const colour = paletteColor(pack.palette);
  const colorOf = (key) => {
    if (key === TRANSPARENT || key === SHADOW_KEY) return null;
    if (!template) return colour(key);
    return EYE_KEYS.has(key) ? null : black;
  };
  const left = Math.floor((size - crop.width * scale) / 2);
  const top = Math.floor((size - crop.height * scale) / 2);
  paintPixels(image, pose.pixels, { crop, left, top, scale, colorOf });
  return image;
}

export function renderAllIcons(pack) {
  return {
    'icon.png': renderAppIcon(pack),
    'trayTemplate.png': renderTrayIcon(pack, 1, true),
    'trayTemplate@2x.png': renderTrayIcon(pack, 2, true),
    'tray.png': renderTrayIcon(pack, 1, false),
    'tray@2x.png': renderTrayIcon(pack, 2, false),
  };
}

function main() {
  const pack = loadPosePack();
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, image] of Object.entries(renderAllIcons(pack))) {
    const bytes = encodePng(image);
    writeFileSync(join(OUT_DIR, name), bytes);
    process.stdout.write(`wrote resources/${name} (${image.width}×${image.height}, ${bytes.length} bytes)\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
