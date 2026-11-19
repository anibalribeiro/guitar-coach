// Runs before the stylesheet so a stored Light or Dark choice never flashes the OS theme.
// This file is deliberately outside the ES-module graph: it must still work when main.js
// fails to load, which is the stale-shell failure the boot-error screen exists for.
(() => {
  let theme = 'system';
  try {
    const raw = localStorage.getItem('t2coach.v1');
    const parsed = raw ? JSON.parse(raw) : null;
    const stored = parsed && parsed.settings ? parsed.settings.theme : null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') theme = stored;
  } catch (e) {}
  document.documentElement.dataset.theme = theme;
})();

(() => {
  const connect = () => {
    const button = document.getElementById('recoverApp');
    if (button) {
      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Clearing…';
        const scope = new URL('./', document.baseURI).href;
        const prefix = 't2coach:' + encodeURIComponent(new URL(scope).pathname) + ':';
        try {
          if (navigator.serviceWorker) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.filter(registration => registration.scope === scope).map(registration => registration.unregister()));
          }
          if (globalThis.caches) {
            const keys = await caches.keys();
            await Promise.all(keys.filter(key => key.startsWith(prefix)).map(key => caches.delete(key)));
          }
        } finally {
          location.reload();
        }
      });
    }

    // The shell's static error screen is the only place a load error can be shown when the
    // module never reached boot(). Keep the message short and leave progress untouched.
    const detail = document.getElementById('bootErrorDetail');
    const boot = document.getElementById('bootError');
    const show = event => {
      if (!boot || !detail || !detail.isConnected) return;
      const value = event && (event.message || (event.reason && event.reason.message) || event.reason);
      if (!value) return;
      detail.textContent = String(value).slice(0, 300);
      detail.hidden = false;
    };
    addEventListener('error', show);
    addEventListener('unhandledrejection', show);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect, { once: true });
  } else {
    connect();
  }
})();
