/** PCM16 helpers and a canonical 44-byte RIFF/WAVE encoder (mono, little-endian). */

const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

/** Float [-1, 1] → signed 16-bit with clipping (asymmetric range like most encoders). */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  return out;
}

export function concatInt16(chunks: readonly Int16Array[]): Int16Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Encodes mono PCM16 samples as a WAV file. */
export function encodeWavPcm16(samples: Int16Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error(`Invalid WAV sample rate ${sampleRate}`);
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) view.setInt16(HEADER_BYTES + i * BYTES_PER_SAMPLE, samples[i], true);
  return bytes;
}
