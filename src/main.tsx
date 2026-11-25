import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { maybeRunAutorun } from './autorun';
import './styles.css';

async function boot() {
  const ran = await maybeRunAutorun().catch(() => false);
  if (ran) return;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
