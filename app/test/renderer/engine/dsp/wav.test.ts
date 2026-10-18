import { describe, expect, it } from 'vitest';
import { concatInt16, encodeWavPcm16, floatToPcm16 } from '@renderer/engine/dsp/wav';

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

describe('encodeWavPcm16', () => {
  it('writes a canonical 44-byte RIFF header for 16 kHz mono PCM16', () => {
    // Arrange
    const samples = Int16Array.from([0, 1000, -1000, 32767, -32768]);

    // Act
    const wav = encodeWavPcm16(samples, 16_000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    // Assert
    expect(wav.length).toBe(44 + samples.length * 2);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it('stores samples little-endian after the header', () => {
    const wav = encodeWavPcm16(Int16Array.from([0x0102, -2]), 16_000);
    expect([...wav.subarray(44)]).toEqual([0x02, 0x01, 0xfe, 0xff]);
  });

  it('encodes an empty capture as a valid header-only file', () => {
    const wav = encodeWavPcm16(new Int16Array(0), 16_000);
    expect(wav.length).toBe(44);
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(0);
  });

  it('rejects an invalid sample rate', () => {
    expect(() => encodeWavPcm16(new Int16Array(1), 0)).toThrow(/sample rate/);
    expect(() => encodeWavPcm16(new Int16Array(1), 44_100.5)).toThrow(/sample rate/);
  });
});

describe('floatToPcm16', () => {
  it('scales, rounds and clips to the 16-bit range', () => {
    const pcm = floatToPcm16(Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2]));
    expect([...pcm]).toEqual([0, 16384, -16384, 32767, -32768, 32767, -32768]);
  });
});

describe('concatInt16', () => {
  it('joins chunks in order without touching the inputs', () => {
    const a = Int16Array.from([1, 2]);
    const b = Int16Array.from([3]);
    const joined = concatInt16([a, b, new Int16Array(0)]);
    expect([...joined]).toEqual([1, 2, 3]);
    expect([...a]).toEqual([1, 2]);
  });
});
