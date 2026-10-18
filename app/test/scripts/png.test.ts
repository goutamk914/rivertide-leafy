import { inflateSync, crc32 as zlibCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  blendPixel, crc32, createImage, encodePng, parseHexColor, PNG_SIGNATURE, roundedRectCoverage,
} from '../../scripts/png.mjs';
import { boundingBox, findPose, loadPosePack, renderAllIcons, trayCrop } from '../../scripts/make-icons.mjs';

interface Chunk { type: string; data: Buffer; crc: number }

function readChunks(png: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    chunks.push({ type, data, crc });
    offset += 12 + length;
  }
  return chunks;
}

describe('PNG encoder', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.from('IEND'))).toBe(zlibCrc32(Buffer.from('IEND')));
  });

  it('writes the signature, a valid IHDR and correct chunk CRCs', () => {
    // Arrange
    const image = createImage(3, 2);

    // Act
    const png = encodePng(image);
    const chunks = readChunks(png);

    // Assert
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const ihdr = chunks[0]!.data;
    expect([ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]]).toEqual([3, 2, 8, 6, 0, 0, 0]);
    for (const chunk of chunks) {
      expect(chunk.crc).toBe(zlibCrc32(Buffer.concat([Buffer.from(chunk.type, 'ascii'), chunk.data])));
    }
  });

  it('round-trips pixels through IDAT (filter byte 0 per row)', () => {
    // Arrange
    const image = createImage(2, 2);
    blendPixel(image, 0, 0, [255, 0, 0, 255]);
    blendPixel(image, 1, 1, [0, 0, 255, 128]);

    // Act
    const idat = readChunks(encodePng(image)).find((c) => c.type === 'IDAT')!;
    const raw = inflateSync(idat.data);

    // Assert
    expect([...raw]).toEqual([0, 255, 0, 0, 255, 0, 0, 0, 0, /* row 2 */ 0, 0, 0, 0, 0, 0, 0, 255, 128]);
  });

  it('rejects mismatched buffers and bad sizes', () => {
    expect(() => encodePng({ width: 2, height: 2, data: new Uint8Array(3) })).toThrow(/expected 16/);
    expect(() => encodePng({ width: 0, height: 2, data: new Uint8Array(0) })).toThrow(/Invalid PNG size/);
  });

  it('parses colours with and without alpha', () => {
    expect(parseHexColor('#0b0c0b')).toEqual([11, 12, 11, 255]);
    expect(parseHexColor('#00000022')).toEqual([0, 0, 0, 34]);
    expect(parseHexColor('#fff')).toEqual([255, 255, 255, 255]);
    expect(() => parseHexColor('green')).toThrow();
  });

  it('blends source-over and anti-aliases rounded corners', () => {
    // Arrange
    const image = createImage(1, 1);
    blendPixel(image, 0, 0, [255, 255, 255, 255]);

    // Act
    blendPixel(image, 0, 0, [0, 0, 0, 255], 0.5);

    // Assert
    expect([...image.data]).toEqual([128, 128, 128, 255]);
    expect(roundedRectCoverage(0, 0, { x: 0, y: 0, size: 100, radius: 20 })).toBe(0);
    expect(roundedRectCoverage(50, 50, { x: 0, y: 0, size: 100, radius: 20 })).toBe(1);
  });
});

describe('icon rendering', () => {
  const pack = loadPosePack();
  const icons = renderAllIcons(pack);

  it('renders every icon at the expected size', () => {
    expect(Object.fromEntries(Object.entries(icons).map(([name, img]) => [name, `${img.width}x${img.height}`]))).toEqual({
      'icon.png': '1024x1024', 'trayTemplate.png': '16x16', 'trayTemplate@2x.png': '32x32', 'tray.png': '16x16', 'tray@2x.png': '32x32',
    });
  });

  it('makes the tray template a pure black silhouette on transparency', () => {
    const { data } = icons['trayTemplate@2x.png'];
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      opaque += 1;
      expect([data[i], data[i + 1], data[i + 2], data[i + 3]]).toEqual([0, 0, 0, 255]);
    }
    expect(opaque).toBeGreaterThan(100);
  });

  it('fits Leafy into 16 px at whole-pixel scale', () => {
    const crop = trayCrop(findPose(pack, 'happy'));
    expect(crop.width).toBeLessThanOrEqual(16);
    expect(crop.height).toBeLessThanOrEqual(16);
  });

  it('leaves the app icon corners transparent and fills the body with the brand background', () => {
    const { data, width } = icons['icon.png'];
    const at = (x: number, y: number) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
    expect(at(0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(150, 512)).toEqual([11, 12, 11, 255]);
  });

  it('finds bounding boxes and refuses empty poses', () => {
    expect(boundingBox(['..', '.x'], (k: string) => k !== '.')).toEqual({ x: 1, y: 1, width: 1, height: 1 });
    expect(() => boundingBox(['..'], (k: string) => k !== '.')).toThrow(/no visible pixels/);
  });
});
