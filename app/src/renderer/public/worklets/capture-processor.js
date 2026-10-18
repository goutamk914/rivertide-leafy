/**
 * Rivertide capture worklet: mixes the input to mono and posts ~20 ms Float32 blocks to the
 * engine's main thread (transferring the buffer, no copies). Messages in:
 *   { type: 'flush' } — post the partially filled block now
 *   { type: 'stop' }  — flush and stop processing (the node can then be garbage collected)
 * Plain JS on purpose: worklets are loaded by URL and are not bundled.
 */
const RENDER_QUANTUM = 128;
const DEFAULT_BATCH_MS = 20;
const MAX_BATCH_MS = 200;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requested = Number(options && options.processorOptions && options.processorOptions.batchMs);
    const batchMs = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_BATCH_MS) : DEFAULT_BATCH_MS;
    const quanta = Math.max(1, Math.round((sampleRate * batchMs) / 1000 / RENDER_QUANTUM));
    this.batchSize = quanta * RENDER_QUANTUM;
    this.buffer = new Float32Array(this.batchSize);
    this.filled = 0;
    this.active = true;
    this.port.onmessage = (event) => {
      const type = event.data && event.data.type;
      if (type === 'flush') this.post();
      if (type === 'stop') {
        this.post();
        this.active = false;
      }
    };
  }

  post() {
    if (this.filled === 0) return;
    const block = this.filled === this.batchSize ? this.buffer : this.buffer.slice(0, this.filled);
    this.port.postMessage(block, [block.buffer]);
    this.buffer = new Float32Array(this.batchSize);
    this.filled = 0;
  }

  process(inputs) {
    if (!this.active) return false;
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const frames = channels[0].length;
    const gain = 1 / channels.length;
    let offset = 0;
    while (offset < frames) {
      const count = Math.min(frames - offset, this.batchSize - this.filled);
      for (let i = 0; i < count; i += 1) {
        let sum = 0;
        for (let c = 0; c < channels.length; c += 1) sum += channels[c][offset + i];
        this.buffer[this.filled + i] = sum * gain;
      }
      this.filled += count;
      offset += count;
      if (this.filled === this.batchSize) this.post();
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
