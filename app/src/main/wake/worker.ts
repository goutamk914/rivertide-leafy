/**
 * Entry of the wake-word utility process (bundled to dist-electron/wake-worker.cjs). Main forks it
 * only while "Hey Leafy" is turned on and kills it when it is turned off. No network, no files
 * written: frames come in over the parent port and only yes/no results go back.
 */
import { createWorkerHost } from './worker-host';
import { createFeatureRunner, createMoonshineRunner, loadOrt, readVocab } from './onnx';

const port = process.parentPort;

const host = createWorkerHost({
  emit: (event) => port.postMessage(event),
  load: async (modelDir) => {
    const ort = loadOrt(process.env['RIVERTIDE_ORT_MODULE']);
    const [features, moonshine, vocab] = await Promise.all([
      createFeatureRunner(ort, modelDir),
      createMoonshineRunner(ort, modelDir),
      readVocab(modelDir),
    ]);
    return { features, moonshine, vocab };
  },
});

port.on('message', (event) => host.onMessage(event.data));
