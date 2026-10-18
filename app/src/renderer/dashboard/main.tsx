/** Entry for the dashboard window (loaded by main.html). */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/tokens.css';
import '../ui/base.css';
import './styles/index';
import { isElectron } from '../lib/ipc';
import { installDevMock } from '../lib/mock-bridge';
import { App } from './App';

if (!isElectron()) installDevMock();

const container = document.getElementById('root');
if (!container) throw new Error('The dashboard page is missing its #root element.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
