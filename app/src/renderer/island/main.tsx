import '../ui/tokens.css';
import './island.css';
import './island-cards.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { reportError } from '../lib/hooks/bridge';
import { ensureDevBridge } from '../lib/hooks/devBridge';
import { IslandApp } from './IslandApp';

async function boot(): Promise<void> {
  await ensureDevBridge();
  const container = document.getElementById('root');
  if (!container) throw new Error('Island window is missing its #root element.');
  createRoot(container).render(
    <StrictMode>
      <IslandApp />
    </StrictMode>,
  );
}

boot().catch((error: unknown) => reportError('island:boot', error));
