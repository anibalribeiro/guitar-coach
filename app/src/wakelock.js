// ---------- Screen wake lock adapter (tier 1, imports nothing) ----------
// The only module that owns `navigator.wakeLock`. It refuses to know about the DOM, the
// settings record or the guitar: whether a lock is *wanted* is the composition root's fact,
// so this adapter only answers in five state words and performs the two verbs.
//
// A denial is a state, not a retry — the same rule `mic.js` applies to a refused microphone.
// The API is secure-context only and a request may be rejected for system settings, power save
// or low battery, so `denied` is a normal outcome and is terminal for the page (D-77, T-05-13).
export const WAKE_STATES = ['off', 'requesting', 'held', 'denied', 'unsupported'];

// A property read, never a call: the preflight must be able to ask about the API without
// requesting anything, and no other module may read it (T-05-16).
export function wakelockSupported(nav = globalThis.navigator) {
  const api = nav && nav.wakeLock;
  return !!(api && typeof api.request === 'function');
}

// One frame's decision, read from the world state and the adapter's own state — never from a
// caller's flag. `wanted` is a live pass on a connected guitar; `visible` is the document.
//   request — nothing is held and the lock is wanted now (the rising edge)
//   release — a held lock is no longer wanted, or the page is hidden
//   idle    — everything else, including every frame after a denial and every unsupported frame
export function wakeLockStep({ wanted = false, state = 'off', visible = true } = {}) {
  // Terminal states: a denial and an absent entry point are never retried (D-77).
  if (state === 'denied' || state === 'unsupported') return 'idle';
  if (!wanted || !visible) return state === 'held' ? 'release' : 'idle';
  return state === 'off' ? 'request' : 'idle';
}

export function createWakeLock({ nav = globalThis.navigator, onState = () => {} } = {}) {
  let state = 'off';
  let sentinel = null;
  let inFlight = null;

  function setState(next) {
    if (!WAKE_STATES.includes(next) || next === state) return state;
    state = next;
    try { onState(state); } catch (e) {}
    return state;
  }

  // The page's own verb and the browser's hidden-document release both land here, so the
  // sentinel is nulled exactly once and the state returns to `off`, never to a held word.
  function release() {
    const held = sentinel;
    sentinel = null;
    if (held && typeof held.release === 'function') {
      // `release()` returns a promise; its rejection is not actionable and must never surface
      // as an unhandled one, so it is swallowed as silently as a denial.
      try {
        const done = held.release();
        if (done && typeof done.catch === 'function') done.catch(() => {});
      } catch (e) {}
    }
    if (state === 'held' || state === 'requesting') setState('off');
    return state;
  }

  // One in-flight request: a second frame that asks before the first promise settles gets the
  // same promise, so two animation frames can never create two locks (Pitfall 6).
  function request() {
    if (inFlight) return inFlight;
    if (!wakelockSupported(nav)) { setState('unsupported'); return Promise.resolve(state); }
    if (state === 'denied' || state === 'unsupported' || state === 'held') return Promise.resolve(state);
    setState('requesting');
    inFlight = (async () => {
      try {
        sentinel = await nav.wakeLock.request('screen');
        setState('held');
      } catch (e) {
        // A refusal latches: `denied` is where this page stays for its whole lifetime.
        sentinel = null;
        setState('denied');
      } finally {
        inFlight = null;
      }
      return state;
    })();
    return inFlight;
  }

  return {
    get state() { return state; },
    get held() { return !!sentinel; },
    request,
    release,
  };
}
