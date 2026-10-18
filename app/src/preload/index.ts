/**
 * Preload (sandboxed): exposes `window.rivertide` and nothing else. Bundled to
 * dist-electron/preload.cjs; it may only require 'electron'.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { createBridge } from './bridge';

contextBridge.exposeInMainWorld('rivertide', createBridge(ipcRenderer, process.platform));
