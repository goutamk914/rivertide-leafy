/**
 * Entry of the hidden engine window (engine.html). Wires the browser APIs (microphone, Web Audio,
 * speechSynthesis) to the Engine and the IPC bridge, then tells main it is ready.
 */
import { invoke, on, send } from '@renderer/lib/ipc';
import { AudioHub } from './audio-hub';
import { CuePlayer } from './cues';
import { Engine } from './engine';
import { createReporter, describeError, toVoiceList, type Reporter } from './report';
import type { SpeechPort } from './tts';

const WORKLET_PATH = 'worklets/capture-processor.js';

function speechPort(): SpeechPort | null {
  if (typeof window.speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return null;
  return { synth: window.speechSynthesis, createUtterance: (text) => new SpeechSynthesisUtterance(text) };
}

function getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new DOMException('Microphone access is unavailable.', 'NotFoundError'));
  return navigator.mediaDevices.getUserMedia(constraints);
}

function watchVoices(report: Reporter): void {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const publish = () => {
    const voices = synth.getVoices();
    if (voices.length > 0) report.voices(toVoiceList(voices));
  };
  synth.addEventListener('voiceschanged', publish);
  publish();
}

function watchGlobalErrors(report: Reporter): void {
  window.addEventListener('error', (event) => report.error('capture', `Unexpected audio engine error: ${event.message || 'unknown'}`));
  window.addEventListener('unhandledrejection', (event) => report.error('capture', `Unexpected audio engine error: ${describeError(event.reason)}`));
}

function boot(): void {
  const report = createReporter({ invoke, send });
  watchGlobalErrors(report);
  const hub = new AudioHub({
    workletUrl: new URL(WORKLET_PATH, document.baseURI).href,
    onError: (message) => report.error('capture', message),
  });
  const engine = new Engine({ report, getUserMedia, audio: hub, speech: speechPort(), cues: new CuePlayer(hub) });

  const unsubscribe = on('engine:command', (command) => engine.handle(command));
  const onDeviceChange = () => engine.onDeviceChange();
  navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
  window.addEventListener('pagehide', () => {
    unsubscribe();
    navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
    engine.dispose()
      .then(() => hub.close())
      .catch((error: unknown) => report.error('capture', `Audio engine shutdown failed: ${describeError(error)}`));
  }, { once: true });

  watchVoices(report);
  void report.ready();
}

try {
  boot();
} catch (error) {
  // Without the bridge there is no channel to main; the console is all that is left.
  console.error('Rivertide audio engine failed to start', error);
}
