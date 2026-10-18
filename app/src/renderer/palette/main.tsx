import '../ui/tokens.css';
import './palette.css';
import './palette-thread.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { reportError } from '../lib/hooks/bridge';
import { ensureDevBridge } from '../lib/hooks/devBridge';
import { PaletteApp } from './PaletteApp';

async function boot(): Promise<void> {
  await ensureDevBridge();
  const container = document.getElementById('root');
  if (!container) throw new Error('Palette window is missing its #root element.');
  createRoot(container).render(
    <StrictMode>
      <PaletteApp />
    </StrictMode>,
  );
}

boot().catch((error: unknown) => reportError('palette:boot', error));
