// ---------- Microphone adapter (tier 1 -> tier 1: mic -> pitch/score) ----------
// The only module that owns a microphone stream. It never calls the browser permission
// API itself and never touches `audio.master`: it forwards the injected request into
// `pitch.js`'s createPitchCapture, which stays the only caller of the permission API, and
// it hands the analyser frames to `score.js`. The state is the only truth — no caller in
// `main`, `panels` or `run` keeps a parallel `listening` flag (T-03-13).
//
//   mic.js  --forwards getUserMedia-->  pitch.js  (the only caller)
//   mic.js  --frames-->                 score.js  (pure, imports nothing)
import { createPitchCapture, tunerReading } from './pitch.js';
import { SCORE, createOnsetState, frameRms, pushFrame } from './score.js';

// The tuner is a read-only view of the same pitch detector. Re-export the pure reading through
// the one module main already imports, so the composition root never gains a direct pitch edge.
export { tunerReading };

export const MIC_STATES = ['off', 'requesting', 'on', 'listening', 'calibrating', 'denied', 'unavailable'];

// One frame's listening-window decision, read from the pass's fixed intent and the
// adapter's own state — never from a caller's flag. Every pass boundary closes the stream
// through the one teardown, so the next pass has to `arm` before it can `open`; that step
// is first-class here rather than a guess in the composition root (CR-01).
//   streamWanted — this pass owns the stream now (its count-in or its active phrase)
//   windowWanted — a scored window should be open right now (an active pass only)
//   open         — the composition root's record that it opened the window
//   state        — the adapter's state, the only truth about the stream
// A denied, absent or still-requesting device is never re-asked: it is a state, not a retry.
export function micWindowStep({
  streamWanted = false, windowWanted = false, open = false, state = 'off',
} = {}) {
  const listening = state === 'listening';
  if (!streamWanted) return open || listening ? 'close' : 'idle';
  // A count-in or a paused pass keeps the stream but no window: re-arm a stream an earlier
  // boundary closed so the first active beat is already listening.
  if (!windowWanted) return open || listening ? 'close' : (state === 'off' ? 'arm' : 'idle');
  if (open) return listening ? 'idle' : 'close';
  if (listening) return 'idle';
  if (state === 'on') return 'open';
  if (state === 'off') return 'arm';
  return 'idle';
}

// The capture harness already allocates one 4096-sample frame per poll; the adapter reads
// the same analyser into one buffer of its own so the onset maths never allocates.
const FRAME_SIZE = 4096;

export function createMic({
  ctx,
  getUserMedia,
  onEvent = () => {},
  onState = () => {},
  timer = globalThis,
  now = () => 0,
  capture = createPitchCapture,
} = {}) {
  const frame = new Float32Array(FRAME_SIZE);
  let state = 'off';
  let engine = null;
  let inFlight = null;
  let generation = 0;
  let onsetState = createOnsetState();

  const armed = () => state === 'on' || state === 'listening' || state === 'calibrating';

  // A property read, never a call: binding the capture API is pitch.js's job alone.
  function hasCapture() {
    if (typeof getUserMedia === 'function') return true;
    const media = globalThis.navigator && globalThis.navigator.mediaDevices;
    return !!(media && typeof media.getUserMedia === 'function');
  }

  function setState(next) {
    if (!MIC_STATES.includes(next) || next === state) return state;
    state = next;
    try { onState(state); } catch (e) {}
    return state;
  }

  function emit(event) {
    try { onEvent(event); } catch (e) {}
  }

  // One poll produces both signals: the onset gate sees the frame and the pitch event
  // carries the note. Nothing is emitted outside a listening window, so the app cannot
  // score itself between windows.
  function handlePitch(freq, midi) {
    if (state !== 'listening' || !engine || !engine.analyser) return;
    engine.analyser.getFloatTimeDomainData(frame);
    const raw = Number(now());
    const atMs = Number.isFinite(raw) ? raw : 0;
    const result = pushFrame(onsetState, frameRms(frame), atMs);
    onsetState = result.state;
    if (result.onset) emit({ type: 'onset', atMs: result.onset.atMs, rms: result.onset.rms });
    if (Number.isFinite(midi)) emit({ type: 'pitch', atMs, midi, freq });
  }

  // Only ever called from a user gesture. Every failure path is a state, never a throw:
  // a denied or unavailable mic leaves the drill running unscored (MIC-03, D-51).
  function arm() {
    if (armed()) return Promise.resolve(state);
    if (inFlight) return inFlight;
    if (!hasCapture()) return Promise.resolve(setState('unavailable'));
    const request = generation;
    setState('requesting');
    const pending = (async () => {
      let next = null;
      try {
        next = capture({ ctx, getUserMedia, onPitch: handlePitch, intervalMs: SCORE.pollMs, timer });
        await next.start();
        // Permission prompts cannot be cancelled; dispose grants whose owner stopped.
        if (request !== generation) { next.stop(); return state; }
        engine = next;
        onsetState = createOnsetState();
        setState('on');
      } catch (e) {
        if (next) { try { next.stop(); } catch (err) {} }
        if (request === generation) { engine = null; setState('denied'); }
      }
      return state;
    })();
    inFlight = pending;
    pending.finally(() => { if (inFlight === pending) inFlight = null; });
    return pending;
  }

  function startListening() {
    if (state !== 'on') return state;
    onsetState = createOnsetState();
    return setState('listening');
  }

  function stopListening() {
    return state === 'listening' ? setState('on') : state;
  }

  function calibrate() {
    return state === 'on' ? setState('calibrating') : state;
  }

  function endCalibration() {
    return state === 'calibrating' ? setState('on') : state;
  }

  // The one teardown path: result, Stop, mic off, tab hidden and pagehide all land here,
  // so no timer survives and no track is left open (T-03-12).
  function stop() {
    generation++;
    inFlight = null;
    if (engine) { try { engine.stop(); } catch (e) {} }
    engine = null;
    onsetState = createOnsetState();
    return setState('off');
  }

  return {
    get state() { return state; },
    arm,
    startListening,
    stopListening,
    calibrate,
    endCalibration,
    disarm: stop,
    stop,
  };
}
