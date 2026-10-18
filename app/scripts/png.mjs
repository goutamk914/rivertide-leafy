/**
 * Zero-dependency PNG encoder and a tiny RGBA raster for the icon generator.
 * Only node:zlib is used (deflate). Output: 8-bit RGBA, no interlace, filter type 0 per row.
 * Used by scripts/make-icons.mjs; tested by test/scripts/png.test.ts.
 */
import { deflateSync } from 'node:zlib';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const BYTES_PER_PIXEL = 4;
const BIT_DEPTH = 8;
const COLOR_TYPE_RGBA = 6;
const FILTER_NONE = 0;
const DEFLATE_LEVEL = 9;
const CRC_POLYNOMIAL = 0xedb88320;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? CRC_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (ISO-HDLC), as PNG requires over chunk type + data. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length (BE u32) · type (4 ASCII) · data · CRC over type+data. */
export function pngChunk(type, data) {
  if (!/^[A-Za-z]{4}$/.test(type)) throw new Error(`Invalid PNG chunk type: ${type}`);
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** Encodes an RGBA image `{ width, height, data }` (data.length === width * height * 4). */
export function encodePng(image) {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Invalid PNG size ${width}x${height}`);
  }
  if (data.length !== width * height * BYTES_PER_PIXEL) {
    throw new Error(`Pixel buffer is ${data.length} bytes; expected ${width * height * BYTES_PER_PIXEL}`);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(BIT_DEPTH, 8);
  header.writeUInt8(COLOR_TYPE_RGBA, 9);
  header.writeUInt8(0, 10); // compression: deflate
  header.writeUInt8(0, 11); // filter method 0
  header.writeUInt8(0, 12); // no interlace

  const stride = width * BYTES_PER_PIXEL;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = FILTER_NONE;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, rowStart + 1);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: DEFLATE_LEVEL })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Raster helpers ────────────────────────────────────────────────────────────────────────────

export function createImage(width, height) {
  return { width, height, data: new Uint8Array(width * height * BYTES_PER_PIXEL) };
}

/** Parses `#rgb`, `#rrggbb` or `#rrggbbaa` into [r, g, b, a] (0–255). */
export function parseHexColor(hex) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex);
  if (!match) throw new Error(`Invalid colour: ${hex}`);
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join('') : match[1];
  const channel = (index) => parseInt(digits.slice(index * 2, index * 2 + 2), 16);
  return [channel(0), channel(1), channel(2), digits.length === 8 ? channel(3) : 255];
}

/** Source-over composites one pixel. `coverage` (0–1) scales the source alpha (anti-aliasing). */
export function blendPixel(image, x, y, rgba, coverage = 1) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const alpha = (rgba[3] / 255) * Math.min(1, Math.max(0, coverage));
  if (alpha <= 0) return;
  const i = (y * image.width + x) * BYTES_PER_PIXEL;
  const d = image.data;
  const dstAlpha = d[i + 3] / 255;
  const outAlpha = alpha + dstAlpha * (1 - alpha);
  for (let c = 0; c < 3; c += 1) {
    const mixed = (rgba[c] * alpha + d[i + c] * dstAlpha * (1 - alpha)) / outAlpha;
    d[i + c] = Math.round(mixed);
  }
  d[i + 3] = Math.round(outAlpha * 255);
}

export function fillRect(image, x0, y0, width, height, rgba) {
  for (let y = y0; y < y0 + height; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) blendPixel(image, x, y, rgba);
  }
}

const AA_SAMPLES = 4;

/** Fraction (0–1) of pixel (px, py) inside a rounded rectangle, by 4×4 supersampling. */
export function roundedRectCoverage(px, py, rect) {
  const { x, y, size, radius } = rect;
  let inside = 0;
  for (let sy = 0; sy < AA_SAMPLES; sy += 1) {
    for (let sx = 0; sx < AA_SAMPLES; sx += 1) {
      const fx = px + (sx + 0.5) / AA_SAMPLES;
      const fy = py + (sy + 0.5) / AA_SAMPLES;
      if (insideRoundedSquare(fx, fy, x, y, size, radius)) inside += 1;
    }
  }
  return inside / (AA_SAMPLES * AA_SAMPLES);
}

function insideRoundedSquare(fx, fy, x, y, size, radius) {
  if (fx < x || fy < y || fx > x + size || fy > y + size) return false;
  const cx = Math.min(Math.max(fx, x + radius), x + size - radius);
  const cy = Math.min(Math.max(fy, y + radius), y + size - radius);
  const dx = fx - cx;
  const dy = fy - cy;
  return dx * dx + dy * dy <= radius * radius;
}
