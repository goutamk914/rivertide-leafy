import '../ui/tokens.css';
import './leafy.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ensureDevBridge } from '../lib/hooks/devBridge';
import { reportError } from '../lib/hooks/bridge';
import { LeafyApp } from './LeafyApp';

async function boot(): Promise<void> {
  await ensureDevBridge();
  const container = document.getElementById('root');
  if (!container) throw new Error('Leafy window is missing its #root element.');
  createRoot(container).render(
    <StrictMode>
      <LeafyApp />
    </StrictMode>,
  );
}

boot().catch((error: unknown) => reportError('leafy:boot', error));
