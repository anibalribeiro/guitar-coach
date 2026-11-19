// Boot-error recovery only (LOOK-02 removed the theme shim, so this file no longer reads
// storage). It stays outside the ES-module graph on purpose: it must still work when main.js
// fails to load, which is the stale-shell failure the boot-error screen exists for.
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
