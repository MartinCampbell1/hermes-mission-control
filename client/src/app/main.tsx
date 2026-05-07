import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './providers';
import App from './App.tsx';
import './donor.css';

async function clearDevServiceWorkerCaches() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;

  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registrations ?? []).map((registration) => registration.unregister()));
  } catch {
    // Best-effort cleanup: stale localhost service workers must not block the dev shell.
  }

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // Cache APIs are not available in every browser/privacy mode.
  }
}

void clearDevServiceWorkerCaches();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>
);
