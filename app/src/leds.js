// ---------- LED frame codec ----------
// See PROTOCOL.md: write F1 + 18-byte fret bitmap to characteristic 0xDC86 of service 0xFFA0.
// One predicate decides what the T2 can light: a fretted, unmuted cell on strings 1-6,
// frets 1-24. Open strings have no LED (there is none at the nut), so fret 0 is never
// lightable. The string check keeps a bad `s` from writing outside the 18 bitmap bytes
// (it would overwrite the F1 command byte). The fret cap stays at the protocol's 24
// bitmap bits so pinned frames stay byte-identical; the app never builds a cell above
// theory.js FRETS (19), the T2's last LED.
export const lightable = n => !!n && !n.muted
  && Number.isInteger(n.s) && n.s >= 1 && n.s <= 6
  && Number.isInteger(n.f) && n.f >= 1 && n.f <= 24;

export function ledFrame(notes) {
  const b = new Uint8Array(19);
  b[0] = 0xF1;
  for (const n of notes) {
    if (!lightable(n)) continue; // open strings have no LED
    const { s, f } = n;
    b[(6 - s) * 3 + Math.ceil(f / 8)] |= 0x80 >> ((f - 1) % 8);
  }
  return b;
}

// Honest counts: the distinct cells the T2 can actually light. Phase 8's readout and any
// guided-credit logic must count with these, never with `led.length`. `lit` counts the
// lightable cells of the lit set, `dark` the lightable shape cells left unlit, and `open`
// every open or muted cell from either list, which is never counted as lit or dark.
export function ledCounts(lit = [], shape = []) {
  const on = new Set(), off = new Set(), open = new Set();
  for (const n of lit || []) {
    if (!n) continue;
    (lightable(n) ? on : open).add(n.s + ':' + n.f);
  }
  for (const n of shape || []) {
    if (!n) continue;
    const key = n.s + ':' + n.f;
    if (!lightable(n)) open.add(key);
    else if (!on.has(key)) off.add(key);
  }
  return { lit: on.size, dark: off.size, open: open.size };
}

export const litCount = notes => ledCounts(notes).lit;

export function frameHex(frame) {
  return Array.from(frame, x => x.toString(16).padStart(2, '0')).join(' ');
}

// ---------- Scene language ----------
// One on/off change per beat at or below 150 BPM; one change per two beats above
// 150 BPM. On for the first phase of the cycle.
export function blinkOnForBeat(beat, bpm) {
  const beatsPerToggle = bpm > 150 ? 2 : 1;
  return Math.floor(beat / beatsPerToggle) % 2 === 0;
}

// Fret 0 stays in the screen set; the codec filters it from the frame. An open
// target never blinks and never substitutes another fret (D-05).
export function sceneFromNotes(notes, { target = null, blink = false, flash = [] } = {}) {
  const openTarget = target !== null && target !== undefined && target.f === 0;
  return {
    lit: notes || [],
    target: target || null,
    blink: openTarget ? false : !!blink,
    flash: flash || [],
  };
}

// Precedence: a blinking target wins. On the off phase the target is removed from
// the lit set; completed non-root notes are already absent from `lit`; the root is
// retained by the caller unless it is the target. An open target is screen-only.
export function frameForScene(scene, beat, bpm) {
  const target = scene.target || null;
  const openTarget = target && target.f === 0;
  const blinkOn = scene.blink && target && !openTarget ? blinkOnForBeat(beat, bpm) : true;
  let lit = scene.lit || [];
  if (target && !blinkOn) lit = lit.filter(n => n.s !== target.s || n.f !== target.f);
  const flash = scene.flash || [];
  return ledFrame(flash.length ? flash : lit);
}

// ---------- Sink ----------
// Only leds.js computes frames; only the injected `send` writes them. The sink holds
// the latest scene, caps writes at 15 Hz, dedupes by hex, sends exactly one zero frame
// on lights-off and reasserts the held scene on reconnect/enable.
export function createLedSink({ send, isConnected = () => false, now = () => 0 }) {
  let enabled = true, held = null, lastHex = '', lastAt = -Infinity, sentZero = false;
  let lastBeat = 0, lastBpm = 70;

  function write(scene, beat, bpm) {
    if (!isConnected()) return false;
    const frame = frameForScene(scene, beat, bpm);
    const hex = frameHex(frame);
    if (hex === lastHex) return false;
    lastAt = now();
    lastHex = hex;
    send(frame);
    return true;
  }

  function sendZero() {
    if (!isConnected()) return;
    const frame = ledFrame([]);
    lastHex = frameHex(frame);
    lastAt = now();
    sentZero = true;
    send(frame);
  }

  return {
    tick(scene, beat, bpm) {
      held = scene;
      lastBeat = beat;
      lastBpm = bpm;
      if (!enabled) {
        if (!sentZero) sendZero();
        return;
      }
      if (!isConnected()) return;
      if (now() - lastAt < 1000 / 15) return;
      write(scene, beat, bpm);
    },
    setEnabled(on) {
      const next = !!on;
      if (next === enabled) return;
      enabled = next;
      lastHex = '';
      sentZero = false;
      if (!enabled) sendZero();
      else if (held && isConnected()) write(held, lastBeat, lastBpm);
    },
    reassert(beat = lastBeat, bpm = lastBpm) {
      lastBeat = beat;
      lastBpm = bpm;
      lastHex = '';
      lastAt = -Infinity;
      sentZero = false;
      if (enabled && held && isConnected()) write(held, beat, bpm);
    },
    reset() {
      lastHex = '';
      lastAt = -Infinity;
      sentZero = false;
    },
    get enabled() { return enabled; },
    get held() { return held; },
  };
}
